/**
 * pattern 验证：正常匹配、非法 pattern、超长 pattern、数量上限、
 * worker 硬中断（ReDoS）与共享总预算、错误形状。
 */

import { describe, expect, it } from 'vitest'
import { validateCore } from '../src/validator.ts'
import { runPatternChecksSync } from '../src/pattern-worker.ts'
import { MAX_PATTERN_BYTES, MAX_PATTERNS, PATTERN_BUDGET_MS } from '../src/limits.ts'

const opts = { maxErrors: 100, strictSchema: true }

describe('pattern matching', () => {
  it('matches with ECMAScript RegExp semantics (search, not anchored)', async () => {
    expect((await validateCore('abc123', { type: 'string', pattern: '\\d+' }, opts)).valid).toBe(true)
    expect((await validateCore('abc', { type: 'string', pattern: '^[a-z]+$' }, opts)).valid).toBe(true)
    expect((await validateCore('ABC', { type: 'string', pattern: '^[a-z]+$' }, opts)).valid).toBe(false)
  })

  it('reports pattern-mismatch with the pattern as expected', async () => {
    const r = await validateCore('xyz', { type: 'string', pattern: '^a+$' }, opts)
    expect(r.valid).toBe(false)
    expect(r.errors[0]).toMatchObject({
      instancePath: '',
      schemaPath: '#/pattern',
      keyword: 'pattern',
      code: 'pattern-mismatch',
      expected: '^a+$',
    })
  })

  it('pattern does not apply to non-strings', async () => {
    expect((await validateCore(123, { type: 'integer', pattern: '\\d+' }, opts)).valid).toBe(true)
  })
})

describe('pattern worker', () => {
  it('runPatternChecksSync shares one budget across all checks', () => {
    const checks = [
      { id: 0, pattern: '^a+$', value: 'aaa', instancePath: '', schemaPath: '#/pattern' },
      { id: 1, pattern: '^b+$', value: 'bbb', instancePath: '', schemaPath: '#/pattern' },
    ]
    const r = runPatternChecksSync(checks, 1000)
    expect(r.timedOut).toBe(false)
    expect(r.matched).toEqual({ 0: true, 1: true })
  })

  it('runPatternChecksSync enforces the 16KiB pattern limit inside the worker', () => {
    const checks = [
      { id: 0, pattern: 'a'.repeat(MAX_PATTERN_BYTES + 1), value: '', instancePath: '', schemaPath: '#/pattern' },
    ]
    expect(() => runPatternChecksSync(checks, 1000)).toThrow('pattern exceeds')
  })

  it('ReDoS pattern is hard-interrupted within the budget; host stays responsive', async () => {
    const pathological = '(a+)+$'
    const input = 'a'.repeat(50_000) + '!'
    const start = Date.now()
    const r = await validateCore(input, { type: 'string', pattern: pathological }, {
      ...opts,
      patternBudgetMs: 150,
    })
    const elapsed = Date.now() - start
    expect(r.valid).toBe(false)
    expect(r.errors.map((e) => e.code)).toContain('pattern-timeout')
    // 硬中断：远小于病理回溯所需时间
    expect(elapsed).toBeLessThan(3_000)
  })

  it('multiple pathological checks share one budget', async () => {
    const input = 'a'.repeat(40_000) + '!'
    const r = await validateCore(
      { one: input, two: input },
      { type: 'object', properties: { one: { type: 'string', pattern: '(a+)+$' }, two: { type: 'string', pattern: '(a+)+$' } } },
      { ...opts, patternBudgetMs: 150 },
    )
    expect(r.valid).toBe(false)
    expect(r.errors.every((e) => e.code === 'pattern-timeout')).toBe(true)
  })
})

describe('pattern schema issues', () => {
  it('invalid pattern → pattern-invalid schema issue (strict fails)', async () => {
    const r = await validateCore('x', { type: 'string', pattern: '(' }, opts)
    expect(r.valid).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.schemaIssues.map((i) => i.code)).toContain('pattern-invalid')
  })

  it('pattern longer than 16KiB → pattern-too-long', async () => {
    const r = await validateCore('x', { type: 'string', pattern: 'a'.repeat(MAX_PATTERN_BYTES + 1) }, opts)
    expect(r.schemaIssues.map((i) => i.code)).toContain('pattern-too-long')
  })

  it(`more than ${MAX_PATTERNS} patterns → pattern-limit`, async () => {
    const properties: Record<string, unknown> = {}
    for (let i = 0; i < MAX_PATTERNS + 1; i++) {
      properties[`p${i}`] = { type: 'string', pattern: `^v${i}$` }
    }
    const schema = { type: 'object', properties }
    const r = await validateCore({}, schema, opts)
    expect(r.schemaIssues.map((i) => i.code)).toContain('pattern-limit')
  })

  it('invalid pattern is skipped in lax mode without worker errors', async () => {
    const r = await validateCore('anything', { type: 'string', pattern: '(' }, { maxErrors: 100, strictSchema: false })
    expect(r.valid).toBeNull()
    expect(r.supportedSubsetValid).toBe(true)
    expect(r.schemaIssues.map((i) => i.code)).toContain('pattern-invalid')
    expect(r.errors).toEqual([])
  })
})

describe('pattern budget constants', () => {
  it('uses the documented budget', () => {
    expect(PATTERN_BUDGET_MS).toBe(1000)
  })
})
