/**
 * normalize：深拷贝（不修改输入、null-prototype）、只应用缺失字段的显式
 * default、不强制类型、default 校验、oneOf/anyOf 分支规则、appliedDefaults
 * 路径、默认值 JSON-compatible。
 */

import { describe, expect, it } from 'vitest'
import { normalizeAction } from '../src/normalize.ts'
import { deepCopyJson } from '../src/normalize.ts'

const opts = { maxErrors: 100, strictSchema: true }

describe('deepCopyJson', () => {
  it('produces null-prototype objects and never mutates the source', () => {
    const src = { a: [1, { b: 'x' }], c: null }
    const copy = deepCopyJson(src) as Record<string, unknown>
    expect(copy).toEqual(src)
    expect(Object.getPrototypeOf(copy)).toBeNull()
    expect(Object.getPrototypeOf((copy.a as unknown[])[1])).toBeNull()
    // 修改副本不影响源
    ;(copy.a as unknown[]).push(99)
    expect(src.a).toHaveLength(2)
  })

  it('treats __proto__/constructor as plain JSON keys', () => {
    const src = JSON.parse('{"__proto__": {"polluted": true}, "constructor": 5}')
    const copy = deepCopyJson(src) as Record<string, unknown>
    expect(Object.hasOwn(copy, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(copy)).toBeNull()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('normalize basics', () => {
  it('applies explicit defaults for missing properties only', async () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        enabled: { type: 'boolean', default: true },
        level: { type: 'integer', default: 3 },
      },
      required: ['name'],
    }
    const r = await normalizeAction({ name: 'A' }, schema, opts)
    expect(r.valid).toBe(true)
    expect(r.value).toEqual({ name: 'A', enabled: true, level: 3 })
    expect(r.appliedDefaults.sort()).toEqual(['/enabled', '/level'])
    expect(r.errors).toEqual([])
  })

  it('does not override existing values', async () => {
    const schema = { type: 'object', properties: { x: { type: 'integer', default: 0 } } }
    const r = await normalizeAction({ x: 5 }, schema, opts)
    expect(r.value).toEqual({ x: 5 })
    expect(r.appliedDefaults).toEqual([])
  })

  it('never mutates the input', async () => {
    const input = { name: 'A' }
    const snapshot = JSON.stringify(input)
    const schema = { type: 'object', properties: { name: { type: 'string' }, flag: { type: 'boolean', default: true } } }
    await normalizeAction(input, schema, opts)
    expect(JSON.stringify(input)).toBe(snapshot)
  })

  it('does not coerce types and does not delete additional properties', async () => {
    const schema = { type: 'object', properties: { n: { type: 'integer' } }, additionalProperties: false }
    const r = await normalizeAction({ n: '5', extra: 1 }, schema, opts)
    // 不强制转换 → n='5' 仍是字符串 → 验证失败
    expect(r.valid).toBe(false)
    expect((r.value as Record<string, unknown>).n).toBe('5')
    // 不删除 additional properties
    expect((r.value as Record<string, unknown>).extra).toBe(1)
    expect(r.errors.map((e) => e.code)).toContain('type-mismatch')
  })

  it('applies nested defaults recursively', async () => {
    const schema = {
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: { name: { type: 'string' }, age: { type: 'integer', default: 0 } },
        },
      },
    }
    const r = await normalizeAction({ user: {} }, schema, opts)
    expect(r.value).toEqual({ user: { age: 0 } })
    expect(r.appliedDefaults).toEqual(['/user/age'])
  })

  it('applies array item defaults via items', async () => {
    const schema = {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'integer' }, ok: { type: 'boolean', default: false } } },
    }
    const r = await normalizeAction([{ id: 1 }, {}], schema, opts)
    expect(r.value).toEqual([{ id: 1, ok: false }, { ok: false }])
    expect(r.appliedDefaults).toEqual(['/0/ok', '/1/ok'])
  })
})

describe('normalize default safety', () => {
  it('skips defaults that fail their sub-schema, with a warning', async () => {
    const schema = { type: 'object', properties: { n: { type: 'integer', default: 'not-an-int' } } }
    const r = await normalizeAction({}, schema, opts)
    expect(r.value).toEqual({})
    expect(r.appliedDefaults).toEqual([])
    expect(r.warnings.map((w) => w.code)).toContain('default-invalid')
    // 结果仍完整验证：{} 对 {properties:{n:...}} 通过
    expect(r.valid).toBe(true)
  })

  it('skips non-JSON-compatible defaults', async () => {
    const schema = { type: 'object', properties: { n: { type: 'object', default: undefined } } }
    // undefined 不是 JSON → 但 schema guard 已拒绝（schema-invalid）→ strict 失败
    const r = await normalizeAction({}, schema, opts)
    expect(r.valid).toBe(false)
    expect(r.complete).toBe(false)
  })

  it('applies defaults through $ref targets', async () => {
    const schema = {
      type: 'object',
      properties: { user: { $ref: '#/$defs/user' } },
      $defs: { user: { type: 'object', properties: { name: { type: 'string' }, enabled: { type: 'boolean', default: true } } } },
    }
    const r = await normalizeAction({ user: {} }, schema, opts)
    expect(r.value).toEqual({ user: { enabled: true } })
    expect(r.appliedDefaults).toEqual(['/user/enabled'])
  })

  it('escapes instancePath tokens in appliedDefaults', async () => {
    const schema = { type: 'object', properties: { 'a/b': { type: 'object', properties: { x: { type: 'integer', default: 1 } } } } }
    const r = await normalizeAction({ 'a/b': {} }, schema, opts)
    expect(r.appliedDefaults).toEqual(['/a~1b/x'])
  })
})

describe('normalize oneOf/anyOf branch rule', () => {
  it('enters the single matching branch and applies its defaults', async () => {
    const schema = {
      oneOf: [
        { type: 'object', properties: { a: { type: 'integer', default: 1 } } },
        { type: 'string' },
      ],
    }
    const r = await normalizeAction({}, schema, opts)
    expect(r.valid).toBe(true)
    expect(r.value).toEqual({ a: 1 })
    expect(r.appliedDefaults).toEqual(['/a'])
  })

  it('skips with a warning when zero or multiple branches match', async () => {
    const schema = {
      anyOf: [
        { type: 'object', properties: { a: { type: 'integer', default: 1 } } },
        { type: 'object', properties: { b: { type: 'integer', default: 2 } } },
      ],
    }
    // 空对象同时匹配两分支（不应用 default 时）→ 保持不变 + warning
    const r = await normalizeAction({}, schema, opts)
    expect(r.value).toEqual({})
    expect(r.appliedDefaults).toEqual([])
    expect(r.warnings.map((w) => w.code)).toContain('normalize-skip-branch')
  })

  it('does not enter a branch that only matches after defaults', async () => {
    const schema = {
      oneOf: [
        { type: 'object', required: ['a'], properties: { a: { type: 'integer', default: 1 } } },
      ],
    }
    // {} 不满足 required（不应用 default）→ 0 分支匹配 → 不应用 default
    const r = await normalizeAction({}, schema, opts)
    expect(r.value).toEqual({})
    expect(r.appliedDefaults).toEqual([])
    expect(r.warnings.map((w) => w.code)).toContain('normalize-skip-branch')
  })
})

describe('normalize output contract', () => {
  it('returns the full document shape', async () => {
    const r = await normalizeAction({ name: 'A' }, { type: 'object', properties: { name: { type: 'string' }, enabled: { type: 'boolean', default: true } } }, opts)
    expect(r).toMatchObject({
      action: 'normalize',
      valid: true,
      value: { name: 'A', enabled: true },
      appliedDefaults: ['/enabled'],
      errors: [],
      schemaIssues: [],
      truncated: false,
    })
    expect(typeof r.complete).toBe('boolean')
    expect(typeof r.supportedSubsetValid).toBe('boolean')
    expect(Array.isArray(r.warnings)).toBe(true)
  })

  it('strict schema issues fail normalize without touching data', async () => {
    const r = await normalizeAction({ a: 1 }, { type: 'object', contains: {} }, opts)
    expect(r.valid).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.value).toEqual({ a: 1 })
    expect(r.appliedDefaults).toEqual([])
  })
})
