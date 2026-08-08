/**
 * DSH 正则工具插件。
 *
 * 注册 `regex` 工具：测试匹配、提取捕获组、安全替换、静态解释正则（不执行代码）。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-regex
 *     name: '@deepseek-ai/dsh-tool-regex'
 *
 * 安全边界（ReDoS 多层防线）：
 * - test/find/replace 在**可终止的 worker 线程**内同步执行，WORKER_BUDGET_MS
 *   到期 worker.terminate() 并返回 `regex: execution timed out`——灾难性回溯
 *   不再能阻塞宿主进程（工具管道的 timeoutMs 对同步阻塞体是协作式，仅靠它不够）。
 * - 输入 64KB / pattern 16KB / replacement 16KB / 输出 1MB / 匹配数 1000 上限
 *   （worker 内再次校验）。
 * - explain 只做静态 tokenizer，不构造 RegExp，天然免疫 ReDoS，保持同步执行。
 */

import type { Context } from 'cordis'
import { Worker } from 'node:worker_threads'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { executeAction, type RegexActionArgs } from './engine.ts'

export const name = '@deepseek-ai/dsh-tool-regex'
export const inject = ['tools']

/** worker 内正则执行的硬预算（毫秒）；到期 terminate 并报错。 */
const WORKER_BUDGET_MS = 1000

interface WorkerRequest { id: number; args: RegexActionArgs }
interface WorkerResponse { id: number; ok: boolean; value?: string; error?: string }

/** 在可终止的 worker 内执行 test/find/replace；超预算硬中断。 */
function executeInWorker(args: RegexActionArgs): Promise<string> {
  return new Promise((resolve, reject) => {
    // 源码态（vitest）引用 ./worker.ts（Node 原生 type-stripping 加载）；
    // 构建态（lib）引用 ./worker.js
    const workerUrl = new URL(
      import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js',
      import.meta.url,
    )
    const worker = new Worker(workerUrl)
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      void worker.terminate()
      reject(new Error(`regex: execution timed out (${WORKER_BUDGET_MS}ms)`))
    }, WORKER_BUDGET_MS)
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      fn()
    }
    worker.once('message', (msg: WorkerResponse) => {
      settle(() => {
        if (msg.ok) resolve(msg.value ?? '')
        else reject(new Error(msg.error ?? 'regex: worker failed'))
      })
    })
    worker.once('error', (err) => {
      settle(() => reject(new Error(`regex: worker error: ${err.message}`)))
    })
    worker.once('exit', (code) => {
      // 仅在未收到响应时可达（正常路径已由 message 处理 settle）；视为失败
      settle(() => reject(new Error(`regex: worker exited with code ${code} before responding`)))
    })
    worker.postMessage({ id: 1, args })
  })
}

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'regex',
    description:
      'Regular expression utilities over text (JavaScript syntax; pattern without surrounding slashes). ' +
      'Actions: test (does input match), find (all matches with index, numbered captures, and named groups; ' +
      'the g flag is added automatically), replace (global safe replacement with $1/$<name>/$$ references), ' +
      'explain (static human-readable breakdown of the pattern; never executes it). ' +
      'test/find/replace run in an isolated worker with a hard 1000ms budget (timeout returns an error); ' +
      'inputs over 64KB, patterns over 16KB, replacements over 16KB, or outputs over 1MB are rejected. ' +
      'Do not use unanchored nested quantifiers (e.g. (a+)+) on large untrusted input: ReDoS risk.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        enum: ['test', 'find', 'replace', 'explain'],
        description: 'Operation to perform.',
      },
      pattern: {
        type: 'string',
        required: true,
        description: 'Regular expression pattern (JavaScript syntax; do not include surrounding slashes).',
      },
      input: {
        type: 'string',
        description: 'Text to match against (required for test/find/replace).',
      },
      flags: {
        type: 'string',
        description: 'Flag characters, e.g. "gi". Supported: g i m s u y d v. Must be unique and valid; unknown flags error out.',
      },
      replacement: {
        type: 'string',
        description: 'Replacement text for replace; supports $1, $2, $<name> references and $$ for a literal dollar sign.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum matches to report (find), default 50, capped at 1000. Prevents unbounded output.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (args) => {
      const action = (args as RegexActionArgs).action
      // explain 是线性静态扫描（pattern ≤16KB），无需 worker；其余动作进 worker 硬预算
      if (action === 'explain') {
        return Promise.resolve(executeAction(args as RegexActionArgs))
      }
      return executeInWorker(args as RegexActionArgs)
    },
    timeoutMs: 1000,
  }))
}
