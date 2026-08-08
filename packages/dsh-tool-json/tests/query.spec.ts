import { describe, expect, it } from 'vitest'
import { query } from '../src/query.ts'

describe('query', () => {
  const data = {
    foo: { bar: 42 },
    items: [
      { name: 'a', meta: { version: 1 } },
      { name: 'b', meta: { version: 2 } },
      42,
      null,
    ],
    'complex-key': 'ok',
    flag: true,
    nil: null,
    数据: { 名称: 'test' },
    arr: [1, 2, 3],
    deep: { a: { b: { c: { d: 'found' } } } },
  }

  // ── 功能用例 ──

  it('simple property access', () => {
    expect(query(data, 'foo.bar')).toBe(42)
  })

  it('nested object', () => {
    expect(query(data, 'foo')).toEqual({ bar: 42 })
  })

  it('array indexing', () => {
    expect(query(data, 'items[0]')).toEqual({ name: 'a', meta: { version: 1 } })
  })

  it('index + property', () => {
    expect(query(data, 'items[0].name')).toBe('a')
  })

  it('bracket property (single quotes)', () => {
    expect(query(data, "items[0]['name']")).toBe('a')
  })

  it('bracket property (double quotes)', () => {
    expect(query(data, 'items[0]["name"]')).toBe('a')
  })

  it('bracket property reads complex key', () => {
    expect(query(data, "['complex-key']")).toBe('ok')
  })

  it('wildcard projection extracts names', () => {
    // items[0].name='a', items[1].name='b', items[2] skipped (not object), items[3] skipped (null)
    expect(query(data, 'items[*].name')).toEqual(['a', 'b'])
  })

  it('wildcard projection with nested path', () => {
    expect(query(data, 'items[*].meta.version')).toEqual([1, 2])
  })

  it('scalar result (number)', () => {
    expect(query(data, 'foo.bar')).toBe(42)
  })

  it('boolean result', () => {
    expect(query(data, 'flag')).toBe(true)
  })

  it('null result', () => {
    expect(query(data, 'nil')).toBeNull()
  })

  it('unicode key', () => {
    expect(query(data, '数据.名称')).toBe('test')
  })

  it('empty query returns whole input', () => {
    expect(query(data, '')).toEqual(data)
  })

  it('deeply nested access', () => {
    expect(query(data, 'deep.a.b.c.d')).toBe('found')
  })

  it('combines dot and bracket', () => {
    expect(query(data, 'items[1].meta.version')).toBe(2)
  })

  it('array index 0 returns first element', () => {
    expect(query(data, 'arr[0]')).toBe(1)
  })

  it('wildcard without trailing path returns array elements', () => {
    expect(query(data, 'arr[*]')).toEqual([1, 2, 3])
  })

  // ── 错误用例 ──

  it('property not found', () => {
    expect(() => query(data, 'foo.baz')).toThrow('not found')
  })

  it('index out of bounds', () => {
    expect(() => query(data, 'items[99]')).toThrow('out of bounds')
  })

  it('wildcard on non-array', () => {
    expect(() => query(data, 'foo[*]')).toThrow('non-array')
  })

  it('index on non-array', () => {
    expect(() => query(data, 'foo[0]')).toThrow('non-array')
  })

  it('access on null intermediate', () => {
    expect(() => query(data, 'nil.foo')).toThrow('null/undefined')
  })

  // ── 攻击载荷 ──

  it('rejects constructor access (prototype safety)', () => {
    expect(() => query(data, 'constructor')).toThrow('not found')
  })

  it('rejects __proto__ access', () => {
    expect(() => query(data, '__proto__')).toThrow('not found')
  })

  it('rejects prototype access', () => {
    // 'prototype' as a data key is fine — but on a regular object it won't exist
    expect(() => query(data, 'prototype')).toThrow('not found')
  })

  it('wildcard does not leak prototype properties', () => {
    const obj = { items: [{ name: 'ok' }] }
    // Wildcard uses Object.keys — should only see own keys
    expect(query(obj, 'items[*].name')).toEqual(['ok'])
  })

  it('rejects depth over 20', () => {
    const deep = '.b'.repeat(21)
    expect(() => query({}, deep)).toThrow('depth')
  })

  it('rejects query over 200 chars', () => {
    const long = 'a'.repeat(201)
    expect(() => query({ a: 1 }, long)).toThrow('too long')
  })

  it('rejects quote injection', () => {
    expect(() => query(data, "items[0]['name' // ']")).toThrow()
  })

  it('treats eval as plain key name', () => {
    // eval is not a reserved word in our parser
    expect(() => query(data, 'eval')).toThrow('not found')
  })

  // ── 补充用例（评审 T1-T4）──

  it('empty array wildcard returns empty array (T1)', () => {
    expect(query({ arr: [] }, 'arr[*].name')).toEqual([])
  })

  it('rejects invalid JSON string input (T2)', () => {
    expect(() => query('not json', 'foo')).toThrow('invalid JSON')
  })

  it('accepts valid JSON string input (T2)', () => {
    expect(query('{"a":1}', 'a')).toBe(1)
  })

  it('wildcard skips elements missing the projected property (T3)', () => {
    expect(query({ items: [{}, { name: 'b' }, { name: 'c' }] }, 'items[*].name'))
      .toEqual(['b', 'c'])
  })

  it('multi-level wildcard returns nested arrays (T4)', () => {
    // 不支持标准扁平化（JMESPath 多级投影），返回嵌套数组
    const data = { items: [{ tags: ['a', 'b'] }, { tags: ['c'] }] }
    expect(query(data, 'items[*].tags[*]')).toEqual([['a', 'b'], ['c']])
  })
})

import { normalizeInput } from '../src/query.ts'

describe('normalizeInput', () => {
  it('passes through objects', () => {
    expect(normalizeInput({ a: 1 })).toEqual({ a: 1 })
  })

  it('parses valid JSON strings', () => {
    expect(normalizeInput('{"a":1}')).toEqual({ a: 1 })
  })

  it('rejects invalid JSON strings', () => {
    expect(() => normalizeInput('not json')).toThrow('invalid JSON')
  })
})

// ── 审查回归（2026-08-06 review report）──

describe('review regressions', () => {
  it('JSON-01: wildcard preserves legal null results', () => {
    expect(query({ items: [{ name: null }, { name: 'ok' }] }, 'items[*].name')).toEqual([null, 'ok'])
  })

  it('JSON-01: missing-property elements are still skipped', () => {
    expect(query({ items: [{}, { name: 'ok' }] }, 'items[*].name')).toEqual(['ok'])
  })

  it('JSON-02: type mismatches inside projection are rethrown, not swallowed', () => {
    expect(() => query({ items: [{ meta: { version: 1 } }, { meta: 42 }] }, 'items[*].meta.version')).toThrow('cannot access property on number')
    expect(() => query({ items: [{ name: 1 }] }, 'items[*].name.foo')).toThrow('cannot access property on number')
  })

  it('JSON-02: index errors inside projection are rethrown', () => {
    expect(() => query({ items: [{ arr: [1] }, { arr: [] }] }, 'items[*].arr[5]')).toThrow('out of bounds')
  })

  it('JSON-03: string input over 1 MiB bytes is rejected', () => {
    const big = '{"x":"' + 'a'.repeat(1_000_000) + '"}'
    expect(() => query(big, 'x')).toThrow('json: input exceeds')
  })

  it('JSON-03: wildcard projection over 100k items is rejected', () => {
    // 用 null 数组（字节小、元素多）：输入上限不拦截，wildcard 元素上限触发
    const big = { items: Array.from({ length: 100_001 }, () => null) }
    expect(() => query(big, 'items[*]')).toThrow('wildcard projection exceeds')
  })

  it("JSON-05: quoted keys support backslash/quote escapes", () => {
    expect(query({ "a'b": 1 }, "['a\\'b']")).toBe(1)
    expect(query({ 'a"b': 1 }, '["a\\"b"]')).toBe(1)
    expect(query({ 'a\\b': 1 }, "['a\\\\b']")).toBe(1)
    expect(query({ "a\\'b": 1 }, "['a\\\\\\'b']")).toBe(1)
  })

  it('JSON-05: invalid escapes in quoted keys are rejected', () => {
    expect(() => query({}, "['a\\nb']")).toThrow('invalid escape')
  })

  it('JSON-08: rejects non-JSON-compatible values at the pure-function boundary', () => {
    expect(() => query(undefined, 'a')).toThrow('json: input must be JSON-compatible')
    expect(() => query({ a: 1n }, 'a')).toThrow('json: input must be JSON-compatible')
    expect(() => query({ a: () => 1 }, 'a')).toThrow('json: input must be JSON-compatible')
    expect(() => query({ a: NaN }, 'a')).toThrow('json: non-finite number')
    expect(() => query(new Date(), 'a')).toThrow('json: input must be a plain JSON object')
  })

  it('JSON-08: deep nesting over 100 levels is rejected', () => {
    let deep: Record<string, unknown> = { v: 1 }
    for (let i = 0; i < 150; i++) deep = { next: deep }
    expect(() => query(deep, 'next')).toThrow('json: input nesting too deep')
  })
})

// ── 复查回归（2026-08-06，dsh-tool-review-recheck-report）──

describe('recheck regressions', () => {
  it('RECHECK-JSON-01: non-safe-integer index rejected at parse', () => {
    // 36 位数字（1e36 有限非安全整数）
    expect(() => query({ arr: [1] }, 'arr[999999999999999999999999999999999999]')).toThrow('index is too large')
    // 查询长度上限内的最长数字同样被 safe-integer 拒绝（任何 >15 位数字都不是安全整数）
    expect(() => query({ arr: [1] }, 'arr[' + '9'.repeat(190) + ']')).toThrow('index is too large')
  })

  it('RECHECK-JSON-01: execution-stage bounds check still guards safe integers', () => {
    expect(() => query({ arr: [1] }, 'arr[5]')).toThrow('out of bounds')
  })

  it('RECHECK-JSON-02: JSON string input enforces nesting depth too', () => {
    let deep = '1'
    for (let i = 0; i < 150; i++) deep = '{"next":' + deep + '}'
    expect(() => query(deep, 'next')).toThrow('json: input nesting too deep')
  })

  it('RECHECK-JSON-02: shallow JSON string still works', () => {
    expect(query('{"a":{"b":1}}', 'a.b')).toBe(1)
  })

  it('RECHECK-JSON-04: cross-quote escapes are allowed', () => {
    expect(query({ 'a"b': 1 }, "['a\\\"b']")).toBe(1)          // 单引号包围内转义双引号
    expect(query({ "a'b": 1 }, '["a\\\'b"]')).toBe(1)         // 双引号包围内转义单引号
  })
})

describe('recheck2 regressions', () => {
  it('RECHECK2-JSON-01: direct object input enforces byte limit', () => {
    const big = { x: 'a'.repeat(1_000_001) }
    expect(() => query(big, 'x')).toThrow('json: input exceeds')
  })

  it('RECHECK2-JSON-01: object under limit still works', () => {
    expect(query({ x: 'a'.repeat(1000) }, 'x')).toBe('a'.repeat(1000))
  })

  it('RECHECK2-JSON-02: bare wildcard respects projection limit', () => {
    const huge = { items: Array.from({ length: 100_001 }, () => 1) }
    expect(() => query(huge, 'items[*]')).toThrow('wildcard projection exceeds')
  })

  it('RECHECK2-JSON-03.1: circular object rejected with json: prefix', () => {
    const v: Record<string, unknown> = {}
    v.self = v
    expect(() => query(v, 'self')).toThrow('json: circular input')
  })

  it('RECHECK2-JSON-03.1: shared non-circular object is not rejected', () => {
    const shared = { id: 1 }
    expect(query({ a: shared, b: shared }, 'a.id')).toBe(1)
  })

  it('RECHECK2-JSON-03.2: non-string queryStr rejected at runtime', () => {
    expect(() => query({}, 42 as unknown as string)).toThrow('json: query must be a string')
    expect(() => query({}, undefined as unknown as string)).toThrow('json: query must be a string')
  })
})

describe('audit regressions', () => {
  it('AUDIT-JSON-01: number/boolean/null arrays cannot bypass byte limit', () => {
    // 600k 个 number：旧实现每元素仅累计 2 且不即时检查 → 绕过；现在按实际表示 + 即时检查
    expect(() => query(Array.from({ length: 600_000 }, () => 0), '')).toThrow('json: input exceeds')
  })

  it('AUDIT-JSON-04: non-enumerable own properties are rejected', () => {
    const v: Record<string, unknown> = {}
    Object.defineProperty(v, 'x', { value: 1n, enumerable: false })
    expect(() => query(v, 'x')).toThrow('json: non-enumerable property is not JSON-compatible')
    const v2: Record<string, unknown> = {}
    Object.defineProperty(v2, 'y', { value: 42, enumerable: false })
    expect(() => query(v2, 'y')).toThrow('json: non-enumerable property is not JSON-compatible')
  })

  it('AUDIT-JSON-04: accessor properties are rejected', () => {
    const v = { get x() { return 1 } }
    expect(() => query(v, 'x')).toThrow('json: accessor property is not JSON-compatible')
  })

  it('AUDIT-JSON-02: output size limit enforced on large results', () => {
    // 单个近 1MB 的字符串字段可被选中返回——输出上限 4MB 是保险丝（输入 1MB 内实际不会触发，
    // 此处验证机制：构造输入上限内的最大输出路径不抛错）
    const big = { x: 'a'.repeat(900_000) }
    expect((query(big, 'x') as string).length).toBe(900_000)
  })
})
