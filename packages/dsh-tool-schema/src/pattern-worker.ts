/**
 * pattern 验证 worker —— 把同步正则匹配隔离到**可终止**的 worker 线程。
 *
 * 设计文档 §5.5：pattern 验证复用 `dsh-tool-regex` 已验证的 worker 硬中断思想，
 * 但复制一个最小、独立的 worker 实现，不要求运行时已安装 regex bundle；
 * 所有 pattern 验证共享总预算（PATTERN_BUDGET_MS = 1000ms），而不是每个 pattern
 * 各获完整预算。
 *
 * 本文件同时承载 host 侧启动器（runPatternChecksInWorker）与 worker 入口
 * （parentPort 存在时注册监听）。worker 入口依赖 Node 对 .ts 的原生
 * type-stripping（构建产物为 .js，两处均可用同一套源码逻辑），URL 切换：
 * 源码态（vitest）引用 ./pattern-worker.ts，构建态（lib）引用 ./pattern-worker.js。
 *
 * 超时语义：
 * - worker 侧：每完成一个 check 后检查累计耗时，超预算则中止剩余 check 并返回
 *   已完成的 matched + timedOut:true；
 * - host 侧：setTimeout(PATTERN_BUDGET_MS) 到期调用 worker.terminate()，灾难性
 *   回溯（如 `(a+)+$`）不再能阻塞宿主进程。
 */

import { parentPort, Worker } from 'node:worker_threads'
import { MAX_PATTERN_BYTES, PATTERN_BUDGET_MS } from './limits.ts'

export interface PatternCheck {
  /** 全局递增 id（host 侧分配）。 */
  id: number
  /** pattern 源码（schema-check 已校验可编译且 ≤ 16 KiB）。 */
  pattern: string
  /** 待匹配字符串。 */
  value: string
  instancePath: string
  schemaPath: string
}

interface WorkerRequest {
  id: number
  checks: PatternCheck[]
  budgetMs: number
}

export interface PatternBatchResult {
  /** checkId → 匹配结果（仅已完成的 check）。 */
  matched: Record<number, boolean>
  /** 是否因预算耗尽而未完成全部 check。 */
  timedOut: boolean
  /** worker 内部错误（防御性；正常路径下 schema-check 已保证 pattern 合法）。 */
  error?: string
}

/**
 * 纯同步执行器：顺序执行全部 check，共享预算。worker 与测试共用；
 * worker 内再次执行 pattern 长度上限校验。
 */
export function runPatternChecksSync(
  checks: PatternCheck[],
  budgetMs: number,
): { matched: Record<number, boolean>; timedOut: boolean } {
  const matched: Record<number, boolean> = {}
  const start = Date.now()
  for (const check of checks) {
    if (Date.now() - start >= budgetMs) return { matched, timedOut: true }
    if (Buffer.byteLength(check.pattern, 'utf8') > MAX_PATTERN_BYTES) {
      throw new Error(`pattern exceeds ${MAX_PATTERN_BYTES} bytes`)
    }
    let re: RegExp
    try {
      re = new RegExp(check.pattern)
    } catch (error) {
      throw new Error(`invalid pattern: ${String((error as Error).message)}`)
    }
    matched[check.id] = re.test(check.value)
  }
  return { matched, timedOut: false }
}

/**
 * 在可终止的 worker 内执行全部 pattern check；总预算到期硬中断。
 * 正常路径永不 reject（超时/worker 崩溃都折叠为 { matched, timedOut } 结果）。
 */
export function runPatternChecksInWorker(
  checks: PatternCheck[],
  budgetMs: number = PATTERN_BUDGET_MS,
): Promise<PatternBatchResult> {
  return new Promise((resolve) => {
    const workerUrl = new URL(
      import.meta.url.endsWith('.ts') ? './pattern-worker.ts' : './pattern-worker.js',
      import.meta.url,
    )
    const worker = new Worker(workerUrl)
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      resolve({ matched: {}, timedOut: true })
    }, budgetMs)
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      fn()
    }
    worker.once('message', (msg: WorkerResponse) => {
      settle(() => {
        if (msg.ok) {
          resolve({ matched: msg.matched ?? {}, timedOut: false })
        } else {
          resolve({ matched: msg.matched ?? {}, timedOut: true, error: msg.error ?? 'pattern worker failed' })
        }
      })
    })
    worker.once('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      settle(() => resolve({ matched: {}, timedOut: true, error: message }))
    })
    worker.once('exit', (code) => {
      // 正常路径已由 message 处理 settle；此处仅未响应时可达 → 视为超时
      settle(() => resolve({ matched: {}, timedOut: true, error: `pattern worker exited with code ${code}` }))
    })
    worker.postMessage({ id: 1, checks, budgetMs } satisfies WorkerRequest)
  })
}

interface WorkerResponse {
  id: number
  ok: boolean
  matched?: Record<number, boolean>
  error?: string
}

// ── worker 入口 ──
if (parentPort) {
  parentPort.on('message', (req: WorkerRequest) => {
    let matched: Record<number, boolean> = {}
    let error: string | undefined
    try {
      const result = runPatternChecksSync(req.checks, req.budgetMs)
      matched = result.matched
      if (result.timedOut) error = `pattern budget exhausted (${req.budgetMs}ms)`
    } catch (e) {
      error = String(e instanceof Error ? e.message : e)
    }
    parentPort!.postMessage({
      id: req.id,
      ok: error === undefined,
      matched,
      ...(error === undefined ? {} : { error }),
    } satisfies WorkerResponse)
  })
}
