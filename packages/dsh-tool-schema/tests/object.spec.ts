/**
 * 对象验证：required 与缺失/null 的区别、properties、additionalProperties
 * （true/false/schema）、minProperties/maxProperties、嵌套路径与指针转义。
 */

import { describe, expect, it } from 'vitest'
import { validateCore } from '../src/validator.ts'

const opts = { maxErrors: 100, strictSchema: true }

describe('required', () => {
  it('distinguishes missing from null', async () => {
    const schema = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
    // null 是 present 的值 → required 通过，但 type 失败
    const r1 = await validateCore({ name: null }, schema, opts)
    expect(r1.errors.map((e) => e.code)).toEqual(['type-mismatch'])
    // 缺失 → required-missing
    const r2 = await validateCore({}, schema, opts)
    expect(r2.errors.map((e) => e.code)).toEqual(['required-missing'])
    expect(r2.errors[0]?.instancePath).toBe('')
    expect(r2.errors[0]?.schemaPath).toBe('#/required')
    expect(r2.errors[0]?.message).toContain('name')
  })

  it('reports each missing required property', async () => {
    const r = await validateCore({}, { type: 'object', required: ['a', 'b', 'c'] }, opts)
    expect(r.errors.map((e) => e.code)).toEqual(['required-missing', 'required-missing', 'required-missing'])
  })
})

describe('properties', () => {
  it('validates nested paths with RFC 6901 pointers', async () => {
    const schema = {
      type: 'object',
      properties: {
        user: { type: 'object', properties: { name: { type: 'string' } } },
      },
    }
    const r = await validateCore({ user: { name: 42 } }, schema, opts)
    expect(r.errors[0]?.instancePath).toBe('/user/name')
    expect(r.errors[0]?.schemaPath).toBe('#/properties/user/properties/name/type')
  })

  it('escapes ~ and / in property names', async () => {
    const schema = {
      type: 'object',
      properties: { 'a/b': { type: 'integer' }, 'c~d': { type: 'string' } },
    }
    const r = await validateCore({ 'a/b': 'x', 'c~d': 5 }, schema, opts)
    const paths = r.errors.map((e) => e.instancePath).sort()
    expect(paths).toEqual(['/a~1b', '/c~0d'])
    expect(r.errors[0]?.schemaPath).toBe('#/properties/a~1b/type')
  })

  it('undeclared keys pass by default (open objects)', async () => {
    const r = await validateCore({ a: 1, extra: true }, { type: 'object', properties: { a: { type: 'integer' } } }, opts)
    expect(r.valid).toBe(true)
  })
})

describe('additionalProperties', () => {
  it('false rejects every undeclared key', async () => {
    const r = await validateCore({ a: 1, b: 2, c: 3 }, { type: 'object', properties: { a: {} }, additionalProperties: false }, opts)
    expect(r.valid).toBe(false)
    expect(r.errors.map((e) => e.instancePath).sort()).toEqual(['/b', '/c'])
    expect(r.errors[0]?.code).toBe('additional-properties')
  })

  it('false with no properties rejects all keys', async () => {
    const r = await validateCore({ a: 1 }, { type: 'object', additionalProperties: false }, opts)
    expect(r.valid).toBe(false)
    expect(r.errors.map((e) => e.instancePath)).toEqual(['/a'])
  })

  it('true allows additional keys', async () => {
    const r = await validateCore({ a: 1, b: 2 }, { type: 'object', properties: { a: {} }, additionalProperties: true }, opts)
    expect(r.valid).toBe(true)
  })

  it('schema validates additional keys', async () => {
    const schema = { type: 'object', properties: { a: {} }, additionalProperties: { type: 'integer' } }
    expect((await validateCore({ a: 1, b: 2 }, schema, opts)).valid).toBe(true)
    const r = await validateCore({ a: 1, b: 'x' }, schema, opts)
    expect(r.valid).toBe(false)
    expect(r.errors[0]?.instancePath).toBe('/b')
    expect(r.errors[0]?.schemaPath).toBe('#/additionalProperties/type')
  })
})

describe('minProperties / maxProperties', () => {
  it('enforces property counts on objects only', async () => {
    expect((await validateCore({ a: 1 }, { minProperties: 1 }, opts)).valid).toBe(true)
    expect((await validateCore({}, { minProperties: 1 }, opts)).valid).toBe(false)
    expect((await validateCore({ a: 1, b: 2 }, { maxProperties: 1 }, opts)).valid).toBe(false)
    expect((await validateCore({ a: 1 }, { maxProperties: 1 }, opts)).valid).toBe(true)
    // 非对象不受影响
    expect((await validateCore([1, 2], { minProperties: 10 }, opts)).valid).toBe(true)
  })
})
