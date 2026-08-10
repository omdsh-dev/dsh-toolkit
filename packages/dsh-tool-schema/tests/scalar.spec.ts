/**
 * 标量验证：boolean schema、type/type 数组、enum/const、数字语义
 * （有限性、integer、multipleOf 容差）、Unicode code point 长度、
 * own-property 访问（`__proto__`/`constructor` 键）。
 */

import { describe, expect, it } from 'vitest'
import { validateCore } from '../src/validator.ts'

const opts = { maxErrors: 100, strictSchema: true }

describe('boolean schema', () => {
  it('true accepts everything', async () => {
    for (const data of [null, 0, 'x', {}, [], true]) {
      const r = await validateCore(data, true, opts)
      expect(r.valid).toBe(true)
      expect(r.complete).toBe(true)
    }
  })

  it('false rejects everything', async () => {
    for (const data of [null, 0, 'x', {}, []]) {
      const r = await validateCore(data, false, opts)
      expect(r.valid).toBe(false)
      expect(r.errors[0]?.code).toBe('boolean-false')
      expect(r.errors[0]?.keyword).toBe('false')
    }
  })
})

describe('type', () => {
  it('validates each supported type', async () => {
    const cases: Array<[unknown, string, boolean]> = [
      [{}, 'object', true],
      [null, 'object', false],
      [[], 'object', false],
      [[1], 'array', true],
      [{}, 'array', false],
      ['s', 'string', true],
      [5, 'string', false],
      [5, 'number', true],
      [3.5, 'integer', false],
      [3, 'integer', true],
      ['3', 'integer', false],
      [true, 'boolean', true],
      [1, 'boolean', false],
      [null, 'null', true],
      [0, 'null', false],
    ]
    for (const [data, type, expected] of cases) {
      const r = await validateCore(data, { type }, opts)
      expect(r.valid).toBe(expected)
    }
  })

  it('reports expected/actual and a stable code', async () => {
    const r = await validateCore('x', { type: 'integer' }, opts)
    expect(r.errors).toEqual([
      {
        instancePath: '',
        schemaPath: '#/type',
        keyword: 'type',
        code: 'type-mismatch',
        message: 'expected integer, received string',
        expected: 'integer',
        actual: 'string',
      },
    ])
  })

  it('supports type arrays (nullable)', async () => {
    expect((await validateCore(null, { type: ['string', 'null'] }, opts)).valid).toBe(true)
    expect((await validateCore('a', { type: ['string', 'null'] }, opts)).valid).toBe(true)
    expect((await validateCore(3, { type: ['string', 'null'] }, opts)).valid).toBe(false)
  })

  it('integer accepts whole numbers including negative and zero', async () => {
    expect((await validateCore(0, { type: 'integer' }, opts)).valid).toBe(true)
    expect((await validateCore(-7, { type: 'integer' }, opts)).valid).toBe(true)
    expect((await validateCore(1e21, { type: 'integer' }, opts)).valid).toBe(true)
  })
})

describe('enum / const', () => {
  it('enum matches structurally (key order independent)', async () => {
    const schema = { enum: [{ a: 1, b: 2 }, 'x', 5, null] }
    expect((await validateCore({ b: 2, a: 1 }, schema, opts)).valid).toBe(true)
    expect((await validateCore('x', schema, opts)).valid).toBe(true)
    expect((await validateCore(5, schema, opts)).valid).toBe(true)
    expect((await validateCore(null, schema, opts)).valid).toBe(true)
    expect((await validateCore({ a: 1 }, schema, opts)).valid).toBe(false)
    expect((await validateCore('y', schema, opts)).valid).toBe(false)
  })

  it('const compares structurally', async () => {
    expect((await validateCore({ a: [1, 2] }, { const: { a: [1, 2] } }, opts)).valid).toBe(true)
    expect((await validateCore({ a: [2, 1] }, { const: { a: [1, 2] } }, opts)).valid).toBe(false)
  })
})

describe('numbers: finiteness, bounds, multipleOf', () => {
  it('finite numbers only; NaN/Infinity rejected by the data guard', async () => {
    const r = await validateCore(NaN, { type: 'number' }, opts)
    expect(r.valid).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.errors[0]?.code).toBe('data-invalid')
  })

  it('minimum / maximum / exclusive bounds (draft 2020-12 numeric form)', async () => {
    expect((await validateCore(0, { minimum: 0 }, opts)).valid).toBe(true)
    expect((await validateCore(-1, { minimum: 0 }, opts)).valid).toBe(false)
    expect((await validateCore(10, { maximum: 10 }, opts)).valid).toBe(true)
    expect((await validateCore(11, { maximum: 10 }, opts)).valid).toBe(false)
    expect((await validateCore(0, { exclusiveMinimum: 0 }, opts)).valid).toBe(false)
    expect((await validateCore(0.01, { exclusiveMinimum: 0 }, opts)).valid).toBe(true)
    expect((await validateCore(10, { exclusiveMaximum: 10 }, opts)).valid).toBe(false)
    expect((await validateCore(9.9, { exclusiveMaximum: 10 }, opts)).valid).toBe(true)
  })

  it('multipleOf uses scaling/tolerance, not raw %', async () => {
    expect((await validateCore(0.3, { multipleOf: 0.1 }, opts)).valid).toBe(true)
    expect((await validateCore(0.35, { multipleOf: 0.1 }, opts)).valid).toBe(false)
    expect((await validateCore(4, { multipleOf: 2 }, opts)).valid).toBe(true)
    expect((await validateCore(4.5, { multipleOf: 2 }, opts)).valid).toBe(false)
    expect((await validateCore(0, { multipleOf: 5 }, opts)).valid).toBe(true)
    expect((await validateCore(1.01, { multipleOf: 0.1 }, opts)).valid).toBe(false)
    expect((await validateCore(1e21, { multipleOf: 2 }, opts)).valid).toBe(true)
  })

  it('multipleOf with non-finite quotient returns a consistent non-multiple', async () => {
    // q 溢出为 Infinity → diff 为 NaN → 判定非倍数（一致、可测试）
    const r = await validateCore(1e308, { multipleOf: 1e-300 }, opts)
    expect(r.valid).toBe(false)
  })
})

describe('strings: Unicode code point length', () => {
  it('counts code points, not UTF-16 code units', async () => {
    // '😀' 是 1 个 code point、2 个 UTF-16 code unit
    expect((await validateCore('😀', { type: 'string', minLength: 1 }, opts)).valid).toBe(true)
    expect((await validateCore('😀', { type: 'string', maxLength: 1 }, opts)).valid).toBe(true)
    expect((await validateCore('a😀', { type: 'string', maxLength: 1 }, opts)).valid).toBe(false)
    expect((await validateCore('a😀', { type: 'string', minLength: 2 }, opts)).valid).toBe(true)
    // 乐符 U+1D11E
    expect((await validateCore('𝄞', { type: 'string', maxLength: 1 }, opts)).valid).toBe(true)
  })

  it('minLength / maxLength report lengths', async () => {
    const r = await validateCore('ab', { type: 'string', minLength: 5 }, opts)
    expect(r.errors[0]?.code).toBe('min-length')
    expect(r.errors[0]?.expected).toBe('5')
    expect(r.errors[0]?.actual).toBe('2')
    const r2 = await validateCore('abcdef', { type: 'string', maxLength: 3 }, opts)
    expect(r2.errors[0]?.code).toBe('max-length')
  })

  it('string keywords do not apply to non-strings', async () => {
    const r = await validateCore(5, { type: 'number', minLength: 10 }, opts)
    expect(r.valid).toBe(true)
  })
})

describe('own-property access: __proto__ / constructor keys', () => {
  it('required sees own `__proto__` key from JSON.parse', async () => {
    const data = JSON.parse('{"__proto__": "x", "name": "a"}')
    expect(Object.hasOwn(data, '__proto__')).toBe(true)
    const r = await validateCore(data, { type: 'object', required: ['__proto__', 'name'] }, opts)
    expect(r.valid).toBe(true)
  })

  it('additionalProperties=false flags own __proto__ / constructor keys without prototype confusion', async () => {
    const data = JSON.parse('{"__proto__": 1, "constructor": 2, "ok": 3}')
    const r = await validateCore(data, { type: 'object', properties: { ok: { type: 'integer' } }, additionalProperties: false }, opts)
    expect(r.valid).toBe(false)
    const codes = r.errors.map((e) => e.code)
    expect(codes.filter((c) => c === 'additional-properties')).toHaveLength(2)
    expect(r.errors.map((e) => e.instancePath).sort()).toEqual(['/__proto__', '/constructor'].sort())
  })

  it('declared constructor property validates normally', async () => {
    const data = JSON.parse('{"constructor": "x"}')
    const r = await validateCore(data, { type: 'object', properties: { constructor: { type: 'string' } } }, opts)
    expect(r.valid).toBe(true)
  })
})
