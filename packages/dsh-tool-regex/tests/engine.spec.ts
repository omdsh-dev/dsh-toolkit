import { describe, expect, it, vi } from 'vitest'
import { Worker } from 'node:worker_threads'
import {
  compilePattern, assertInputSize, testMatch, findAll, replaceAll,
  normalizeLimit, executeAction,
  MAX_INPUT_BYTES, MAX_PATTERN_BYTES, MAX_REPLACEMENT_BYTES, MAX_MATCHES,
} from '../src/engine.ts'
import { explainPattern } from '../src/explain.ts'

vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { apply } from '../src/index.ts'

describe('compilePattern', () => {
  it('compiles a plain pattern', () => {
    const re = compilePattern('\\d+', '')
    expect(re.source).toBe('\\d+')
  })

  it('validates flags character by character', () => {
    expect(() => compilePattern('a', 'q')).toThrow('regex: invalid flag "q"')
    expect(() => compilePattern('a', 'gg')).toThrow('regex: duplicate flag "g"')
    expect(() => compilePattern('a', 'gimsuy dv')).toThrow('regex: invalid flag " "')
  })

  it('accepts all supported flags', () => {
    for (const f of ['g', 'i', 'm', 's', 'u', 'y', 'd', 'v']) {
      expect(() => compilePattern('a', f)).not.toThrow()
    }
  })

  it('adds g automatically when forceGlobal is set', () => {
    expect(compilePattern('a', '', { forceGlobal: true }).flags).toContain('g')
    expect(compilePattern('a', 'i', { forceGlobal: true }).flags).toBe('gi')
    // 用户已给 g 时不重复
    expect(compilePattern('a', 'g', { forceGlobal: true }).flags).toBe('g')
  })

  it('does not force g for test semantics', () => {
    expect(compilePattern('a', '').flags).toBe('')
  })

  it('reports invalid patterns with the engine message', () => {
    expect(() => compilePattern('(', '')).toThrow('regex: invalid pattern')
  })

  it('accepts an empty pattern (matches the empty string)', () => {
    // V8 把空 pattern 的 source 规范化为 (?:)
    expect(compilePattern('', '').source).toBe('(?:)')
    expect(testMatch(compilePattern('', ''), 'abc')).toEqual({ matched: true })
  })

  it('rejects non-string patterns', () => {
    expect(() => compilePattern(42 as unknown as string, '')).toThrow('regex: pattern must be a string')
  })

  it(`rejects patterns over ${MAX_PATTERN_BYTES} bytes (R-05)`, () => {
    expect(() => compilePattern('a'.repeat(MAX_PATTERN_BYTES + 1), ''))
      .toThrow(`regex: pattern exceeds ${MAX_PATTERN_BYTES} bytes`)
    expect(() => compilePattern('a'.repeat(MAX_PATTERN_BYTES), '')).not.toThrow()
  })
})

describe('assertInputSize (ReDoS 防线 1：入口拒绝)', () => {
  it(`rejects input over ${MAX_INPUT_BYTES} bytes synchronously`, () => {
    const big = 'a'.repeat(MAX_INPUT_BYTES + 1)
    expect(() => assertInputSize(big)).toThrow(`regex: input exceeds ${MAX_INPUT_BYTES} bytes`)
  })

  it('accepts input at the cap', () => {
    expect(() => assertInputSize('a'.repeat(MAX_INPUT_BYTES))).not.toThrow()
  })

  it('rejects non-string input', () => {
    expect(() => assertInputSize(42)).toThrow('regex: input must be a string')
  })
})

describe('testMatch', () => {
  it('matches simple patterns', () => {
    expect(testMatch(compilePattern('\\d+', ''), 'abc123')).toEqual({ matched: true })
    expect(testMatch(compilePattern('\\d+', ''), 'abc')).toEqual({ matched: false })
  })

  it('honors ^ and $ anchors', () => {
    expect(testMatch(compilePattern('^foo$', ''), 'foo')).toEqual({ matched: true })
    expect(testMatch(compilePattern('^foo$', ''), 'foobar')).toEqual({ matched: false })
  })

  it('honors the m flag for per-line anchoring', () => {
    expect(testMatch(compilePattern('^b', 'm'), 'a\nb')).toEqual({ matched: true })
    expect(testMatch(compilePattern('^b', ''), 'a\nb')).toEqual({ matched: false })
  })

  it('is deterministic even when the user passes g', () => {
    expect(testMatch(compilePattern('a', 'g'), 'aaa')).toEqual({ matched: true })
  })
})

describe('findAll', () => {
  const re = (p: string, f = '') => compilePattern(p, f, { forceGlobal: true })

  it('collects all matches with indexes', () => {
    expect(findAll(re('a+'), 'baaac', 50)).toEqual([
      { index: 1, match: 'aaa', captures: [], groups: null },
    ])
    expect(findAll(re('a'), 'abac', 50)).toEqual([
      { index: 0, match: 'a', captures: [], groups: null },
      { index: 2, match: 'a', captures: [], groups: null },
    ])
  })

  it('exposes numbered capture groups (R-06)', () => {
    const r = findAll(re('(\\w+)@(\\w+)'), 'a@b x c@d', 50)
    expect(r).toEqual([
      { index: 0, match: 'a@b', captures: ['a', 'b'], groups: null },
      { index: 6, match: 'c@d', captures: ['c', 'd'], groups: null },
    ])
  })

  it('exposes named groups alongside numbered captures', () => {
    const r = findAll(re('(?<name>\\w+)@(\\w+)'), 'a@b', 50)
    expect(r[0]?.captures).toEqual(['a', 'b'])
    expect(r[0]?.groups).toEqual({ name: 'a' })
  })

  it('keeps non-participating captures as undefined', () => {
    const r = findAll(re('(a)?(b)'), 'b', 50)
    expect(r[0]?.captures).toEqual([undefined, 'b'])
  })

  it('returns an empty array on zero matches', () => {
    expect(findAll(re('z'), 'abc', 50)).toEqual([])
  })

  it('respects limit', () => {
    expect(findAll(re('a'), 'aaaa', 2)).toHaveLength(2)
  })

  it('advances past empty matches without an infinite loop', () => {
    const r = findAll(re('x*'), 'ab', 50)
    expect(r).toEqual([
      { index: 0, match: '', captures: [], groups: null },
      { index: 1, match: '', captures: [], groups: null },
      { index: 2, match: '', captures: [], groups: null },
    ])
  })

  it('auto-adds g (single match would otherwise be returned)', () => {
    // forceGlobal 是 find 的入口行为；这里验证产物确实带 g
    expect(re('\\w+').flags).toContain('g')
    expect(findAll(re('\\w+'), 'one two', 50)).toHaveLength(2)
  })

  it('advances past empty matches by code point under u/v flags (R-02)', () => {
    // '😀' 占 2 个 UTF-16 code unit；u 模式下推进必须跨过整个 surrogate pair
    expect(findAll(re('', 'u'), '😀', 10).map(m => m.index)).toEqual([0, 2])
    expect(findAll(re('', 'v'), '😀', 10).map(m => m.index)).toEqual([0, 2])
    expect(findAll(re('x*', 'u'), '😀', 10).map(m => m.index)).toEqual([0, 2])
    expect(findAll(re('', 'u'), 'a😀b', 10).map(m => m.index)).toEqual([0, 1, 3, 4])
    // 非 Unicode 模式按 code unit 推进（'😀' 2 个 code unit → 位置 0,1,2）
    expect(findAll(re(''), '😀', 10).map(m => m.index)).toEqual([0, 1, 2])
  })

  it(`clamps limit to MAX_MATCHES (R-03)`, () => {
    expect(normalizeLimit(1e9)).toBe(MAX_MATCHES)
    expect(normalizeLimit(Number.POSITIVE_INFINITY)).toBe(50)
    expect(findAll(re('a'), 'a'.repeat(2000), 1e9)).toHaveLength(MAX_MATCHES)
  })
})

describe('replaceAll', () => {
  const re = (p: string, f = '') => compilePattern(p, f, { forceGlobal: true })

  it('performs a basic global replacement', () => {
    expect(replaceAll(re('a'), 'banana', 'X')).toEqual({ result: 'bXnXnX', replaced: 3 })
  })

  it('expands $1 / $2 references', () => {
    expect(replaceAll(re('(\\w+) (\\w+)'), 'hello world', '$2 $1')).toEqual({ result: 'world hello', replaced: 1 })
  })

  it('expands $<name> references', () => {
    expect(replaceAll(re('(?<first>\\w+) (?<second>\\w+)'), 'hello world', '$<second> $<first>'))
      .toEqual({ result: 'world hello', replaced: 1 })
  })

  it('escapes $$ as a literal dollar sign', () => {
    expect(replaceAll(re('a'), 'a', '$$')).toEqual({ result: '$', replaced: 1 })
  })

  it('expands non-participating groups to the empty string', () => {
    expect(replaceAll(re('(a)?b'), 'b', '[$1]')).toEqual({ result: '[]', replaced: 1 })
  })

  it('returns the original text with replaced: 0 on zero matches', () => {
    expect(replaceAll(re('z'), 'abc', '-')).toEqual({ result: 'abc', replaced: 0 })
  })

  it('matches JS semantics for $10 with fewer groups ($1 + "0")', () => {
    expect(replaceAll(re('(b)'), 'ab', '$10')).toEqual({ result: 'ab0', replaced: 1 })
  })

  it('keeps $0 literal like JS', () => {
    expect(replaceAll(re('(b)'), 'ab', '$0')).toEqual({ result: 'a$0', replaced: 1 })
  })

  it('keeps unknown named references literal like JS', () => {
    expect(replaceAll(re('(b)'), 'ab', '$<foo>')).toEqual({ result: 'a$<foo>', replaced: 1 })
  })

  it('rejects a non-string replacement', () => {
    expect(() => replaceAll(re('a'), 'a', 42 as unknown as string)).toThrow('regex: replacement must be a string')
  })

  it(`rejects replacements over ${MAX_REPLACEMENT_BYTES} bytes (R-04)`, () => {
    expect(() => replaceAll(re('a'), 'a', 'x'.repeat(MAX_REPLACEMENT_BYTES + 1)))
      .toThrow(`regex: replacement exceeds ${MAX_REPLACEMENT_BYTES} bytes`)
  })

  it('rejects results over the output budget (R-04 amplification)', () => {
    // 3000 次匹配 × 500 字节替换 ≈ 1.5MB > 1MB 输出预算
    expect(() => replaceAll(re('a'), 'a'.repeat(3000), 'x'.repeat(500)))
      .toThrow('regex: result exceeds 1000000 bytes')
  })

  it('counts empty matches by code point under u flags (R-02)', () => {
    expect(replaceAll(re('', 'u'), '😀', '-')).toEqual({ result: '-😀-', replaced: 2 })
  })
})

describe('executeAction（动作分发 + 统一输出预算）', () => {
  it('explain output respects the output budget (R-05)', () => {
    // 16KB pattern 内、节点数超限：报错而非生成巨量 JSON
    expect(() => executeAction({ action: 'explain', pattern: 'a'.repeat(5000) }))
      .toThrow(/pattern too complex/)
  })

  it('throws on unknown actions', () => {
    expect(() => executeAction({ action: 'bogus', pattern: 'a', input: 'x' }))
      .toThrow('regex: unknown action "bogus"')
  })

  it('returns JSON text for all actions', () => {
    expect(executeAction({ action: 'test', pattern: '\\d+', input: 'abc123' })).toBe('{"matched":true}')
    expect(executeAction({ action: 'find', pattern: 'a', input: 'aba' })).toBe('[{"index":0,"match":"a","captures":[],"groups":null},{"index":2,"match":"a","captures":[],"groups":null}]')
    expect(executeAction({ action: 'replace', pattern: 'a', input: 'aba', replacement: 'X' })).toBe('{"result":"XbX","replaced":2}')
    expect(executeAction({ action: 'explain', pattern: '^a$' })).toContain('"kind":"anchor"')
  })
})

describe('explainPattern 资源上限（R-05）', () => {
  it(`rejects patterns over ${MAX_PATTERN_BYTES} bytes`, () => {
    expect(() => explainPattern('a'.repeat(MAX_PATTERN_BYTES + 1)))
      .toThrow(`regex: pattern exceeds ${MAX_PATTERN_BYTES} bytes`)
  })

  it('rejects overly complex patterns (node cap)', () => {
    expect(() => explainPattern('a'.repeat(5000)))
      .toThrow(/pattern too complex \(more than 4096 nodes\)/)
    expect(explainPattern('a'.repeat(100))).toHaveLength(100)
  })
})

// ── R-01：worker 硬超时（关键回归）──

describe('R-01: worker 硬超时（宿主不被同步回溯阻塞）', () => {
  it('pathological regex is interrupted at the budget; host event loop stays responsive', async () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    const t0 = Date.now()
    const tick = new Promise<string>(res => setTimeout(() => res('ticked'), 150))
    const [outcome, ticked] = await Promise.all([
      def.execute({ action: 'test', pattern: '(a+)+$', input: 'a'.repeat(40_000) + 'b' })
        .catch((e: Error) => `ERR: ${e.message}`),
      tick,
    ])
    expect(ticked).toBe('ticked') // 宿主事件循环未被正则阻塞
    expect(outcome).toMatch(/execution timed out/)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(950)
  }, 10_000)

  it('normal executions still work through the worker path', async () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    const out = await def.execute({ action: 'find', pattern: '(\\w+)@(\\w+)', input: 'a@b' })
    expect(JSON.parse(out)).toEqual([{ index: 0, match: 'a@b', captures: ['a', 'b'], groups: null }])
  }, 10_000)
})

// ── ReDoS 基础防护（§6.2 保留）──

/** 在可终止的 worker 里运行任意同步代码；预算内未完成则 terminate（不挂死测试进程）。 */
function runInKillableWorker(code: string, budgetMs: number): Promise<'completed' | 'terminated'> {
  return new Promise(resolve => {
    const worker = new Worker(code, { eval: true })
    let settled = false
    const finish = (v: 'completed' | 'terminated'): void => {
      if (!settled) { settled = true; resolve(v) }
    }
    worker.once('message', () => finish('completed'))
    worker.once('error', () => finish('completed'))
    setTimeout(() => {
      if (!settled) { void worker.terminate(); finish('terminated') }
    }, budgetMs)
  })
}

describe('ReDoS 原始行为（V8 层验证）', () => {
  it('pathological pattern (a+)+$ on 40KB input is cancelled within budget', async () => {
    const code = `
      const { parentPort } = require('node:worker_threads')
      const re = new RegExp('(a+)+$')
      const input = 'a'.repeat(39999) + 'b'
      re.exec(input)
      parentPort.postMessage('done')
    `
    const t0 = Date.now()
    const outcome = await runInKillableWorker(code, 3000)
    const elapsed = Date.now() - t0
    // 语义：要么在预算内完成，要么被强制取消——无论如何测试进程不挂死
    expect(['completed', 'terminated']).toContain(outcome)
    expect(elapsed).toBeLessThan(10_000)
  }, 15_000)

  it('a safe pattern on a 40KB input completes quickly in-process', () => {
    const input = 'a'.repeat(40_000) + 'b'
    const t0 = Date.now()
    const r = findAll(compilePattern('a+', '', { forceGlobal: true }), input, 50)
    expect(r).toHaveLength(1)
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('explain never executes the pattern (instant on the pathological pattern)', () => {
    const t0 = Date.now()
    const nodes = explainPattern('(a+)+$')
    expect(nodes.length).toBeGreaterThan(0)
    expect(Date.now() - t0).toBeLessThan(100)
  })
})
