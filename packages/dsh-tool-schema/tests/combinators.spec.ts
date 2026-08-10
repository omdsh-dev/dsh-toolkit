/**
 * 组合关键字：allOf / anyOf / oneOf / not —— 匹配语义、分支摘要、
 * 嵌套组合、与 pattern 的 deferred 结算交互。
 */

import { describe, expect, it } from 'vitest'
import { validateCore } from '../src/validator.ts'

const opts = { maxErrors: 100, strictSchema: true }

describe('allOf', () => {
  it('requires every branch; outputs per-branch errors with real schemaPaths', async () => {
    const schema = {
      allOf: [{ type: 'object', properties: { a: { type: 'integer' } } }, { type: 'object', properties: { b: { type: 'string' } } }],
    }
    expect((await validateCore({ a: 1, b: 'x' }, schema, opts)).valid).toBe(true)
    const r = await validateCore({ a: 'nope', b: 5 }, schema, opts)
    expect(r.valid).toBe(false)
    expect(r.errors.map((e) => e.schemaPath).sort()).toEqual([
      '#/allOf/0/properties/a/type',
      '#/allOf/1/properties/b/type',
    ])
  })

  it('accepts an empty allOf (vacuously true)', async () => {
    expect((await validateCore(5, { allOf: [] }, opts)).valid).toBe(true)
  })
})

describe('anyOf', () => {
  it('passes when at least one branch matches', async () => {
    const schema = { anyOf: [{ type: 'integer' }, { type: 'string' }] }
    expect((await validateCore(5, schema, opts)).valid).toBe(true)
    expect((await validateCore('x', schema, opts)).valid).toBe(true)
  })

  it('fails with a top-level error and bounded branch summaries', async () => {
    const r = await validateCore(true, { anyOf: [{ type: 'integer' }, { type: 'string' }] }, opts)
    expect(r.valid).toBe(false)
    const e = r.errors[0]!
    expect(e.keyword).toBe('anyOf')
    expect(e.code).toBe('any-of')
    expect(e.instancePath).toBe('')
    expect(e.schemaPath).toBe('#/anyOf')
    expect(e.branches).toHaveLength(2)
    expect(e.branches![0]!.branch).toBe(0)
    expect(e.branches![0]!.errors[0]!.code).toBe('type-mismatch')
    expect(e.branches![1]!.errors[0]!.code).toBe('type-mismatch')
  })

  it('bounded branch summaries: at most 3 errors per branch', async () => {
    const schema = {
      anyOf: [
        { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' }, c: { type: 'integer' }, d: { type: 'integer' } } },
      ],
    }
    const r = await validateCore({ a: 'x', b: 'x', c: 'x', d: 'x' }, schema, opts)
    expect(r.valid).toBe(false)
    expect(r.errors[0]!.branches![0]!.errors.length).toBeLessThanOrEqual(3)
  })

  it('pattern failures inside branches are respected (deferred settlement)', async () => {
    // branch 0 匹配但 pattern 失败 → 仍视为分支失败 → anyOf 全部失败
    const schema = { anyOf: [{ type: 'string', pattern: '^a+$' }, { type: 'integer' }] }
    const r = await validateCore('bbb', schema, opts)
    expect(r.valid).toBe(false)
    expect(r.errors[0]!.code).toBe('any-of')
    expect(r.errors[0]!.branches![0]!.errors.map((e) => e.code)).toContain('pattern-mismatch')
    // 匹配 pattern 的分支通过
    expect((await validateCore('aaa', schema, opts)).valid).toBe(true)
  })
})

describe('oneOf', () => {
  it('passes when exactly one branch matches', async () => {
    expect((await validateCore(5, { oneOf: [{ type: 'integer' }, { type: 'string' }] }, opts)).valid).toBe(true)
    expect((await validateCore('x', { oneOf: [{ type: 'integer' }, { type: 'string' }] }, opts)).valid).toBe(true)
  })

  it('reports zero matches with branch summaries', async () => {
    const r = await validateCore(true, { oneOf: [{ type: 'integer' }, { type: 'string' }] }, opts)
    expect(r.valid).toBe(false)
    expect(r.errors[0]!.code).toBe('one-of')
    expect(r.errors[0]!.branches).toHaveLength(2)
  })

  it('reports multiple matches with matched branch indexes', async () => {
    const r = await validateCore(5, { oneOf: [{ type: 'integer' }, { type: 'number' }] }, opts)
    expect(r.valid).toBe(false)
    expect(r.errors[0]!.code).toBe('one-of-multiple')
    expect(r.errors[0]!.matchedBranches).toEqual([0, 1])
  })

  it('multiple matches are not fooled by overlapping objects', async () => {
    const schema = {
      oneOf: [
        { type: 'object', required: ['a'], properties: { a: { type: 'integer' } } },
        { type: 'object', required: ['b'], properties: { b: { type: 'integer' } } },
      ],
    }
    expect((await validateCore({ a: 1, b: 2 }, schema, opts)).valid).toBe(false)
    expect((await validateCore({ a: 1 }, schema, opts)).valid).toBe(true)
  })
})

describe('not', () => {
  it('fails when the subschema matches', async () => {
    const r = await validateCore('s', { not: { type: 'string' } }, opts)
    expect(r.valid).toBe(false)
    expect(r.errors[0]!.keyword).toBe('not')
    expect(r.errors[0]!.schemaPath).toBe('#/not')
  })

  it('passes when the subschema does not match', async () => {
    expect((await validateCore(5, { not: { type: 'string' } }, opts)).valid).toBe(true)
  })

  it('not with pattern subschema is settled after the pattern phase', async () => {
    expect((await validateCore('aaa', { not: { type: 'string', pattern: '^a+$' } }, opts)).valid).toBe(false)
    expect((await validateCore('bbb', { not: { type: 'string', pattern: '^a+$' } }, opts)).valid).toBe(true)
  })
})

describe('nested combinators', () => {
  it('anyOf inside not inside oneOf resolves correctly', async () => {
    const schema = {
      oneOf: [
        { type: 'integer' },
        { not: { anyOf: [{ type: 'string' }, { type: 'boolean' }] } },
      ],
    }
    // 5 → branch0 匹配；branch1: not(anyOf(string|boolean)) 对 5 → anyOf 失败 → not 通过 → 两分支匹配
    const r1 = await validateCore(5, schema, opts)
    expect(r1.errors[0]!.code).toBe('one-of-multiple')
    // 'x' → branch0 失败；branch1: anyOf 匹配 → not 失败 → 仅 branch0 失败 → one-of
    const r2 = await validateCore('x', schema, opts)
    expect(r2.errors[0]!.code).toBe('one-of')
    // 3.5 → branch0 失败；branch1: anyOf(string|boolean) 对 3.5 失败 → not 通过 → 恰好一支 → valid
    const r3 = await validateCore(3.5, schema, opts)
    expect(r3.valid).toBe(true)
  })

  it('oneOf branch match count is unaffected by sibling pattern checks', async () => {
    const schema = {
      oneOf: [
        { type: 'string', pattern: '^x+$' },
        { type: 'string', minLength: 3 },
      ],
    }
    // 'xxx'：pattern 与 minLength 都匹配 → 两分支 → one-of-multiple
    expect((await validateCore('xxx', schema, opts)).valid).toBe(false)
    expect((await validateCore('xxx', schema, opts)).errors[0]!.code).toBe('one-of-multiple')
    // 'xx'：仅 pattern 匹配 → 恰好一支 → valid
    expect((await validateCore('xx', schema, opts)).valid).toBe(true)
    // 'xy'：两支都失败 → one-of
    expect((await validateCore('xy', schema, opts)).errors[0]!.code).toBe('one-of')
  })
})
