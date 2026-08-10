/**
 * 本地 `$ref`：`#` 与 `#/$defs/<token>`、RFC 6901 转义、目标存在性、
 * 纯 `$ref` 环（静态 issue + 动态错误）、引用链深度、随 instance 结构前进的
 * 递归 schema。
 */

import { describe, expect, it } from 'vitest'
import { validateCore } from '../src/validator.ts'
import { parseRef, resolveRef, unescapeToken } from '../src/ref.ts'

const opts = { maxErrors: 100, strictSchema: true }
const lax = { maxErrors: 100, strictSchema: false }

describe('pointer utilities', () => {
  it('parseRef accepts # and #/... only', () => {
    expect(parseRef('#')).toEqual({ ok: true, tokens: [] })
    expect(parseRef('#/$defs/a')).toEqual({ ok: true, tokens: ['$defs', 'a'] })
    expect(parseRef('http://x/y').ok).toBe(false)
    expect(parseRef('other.json#/a').ok).toBe(false)
    expect(parseRef('#foo').ok).toBe(false) // anchor 形式不支持
  })

  it('unescapeToken decodes RFC 6901 escapes', () => {
    expect(unescapeToken('a~1b')).toBe('a/b')
    expect(unescapeToken('a~0b')).toBe('a~b')
    expect(unescapeToken('~01')).toBe('~1') // ~0 先于 ~1 之后字面 ~1
    expect(unescapeToken('~2')).toBeNull()
    expect(unescapeToken('a~')).toBeNull()
  })

  it('resolveRef navigates $defs with escaped tokens', () => {
    const schema = { $defs: { 'a/b': { type: 'integer' }, 'c~d': { type: 'string' } } }
    expect(resolveRef(schema, '#/$defs/a~1b').ok).toBe(true)
    expect(resolveRef(schema, '#/$defs/c~0d').ok).toBe(true)
    expect(resolveRef(schema, '#/$defs/nope').ok).toBe(false)
    expect(resolveRef(schema, '#/properties/x').ok).toBe(false) // 非 $defs 首 token
  })
})

describe('$ref validation', () => {
  it('resolves #/$defs targets and reports target-relative schemaPaths', async () => {
    const schema = {
      type: 'object',
      properties: { user: { $ref: '#/$defs/user' } },
      $defs: { user: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
    }
    expect((await validateCore({ user: { name: 'a' } }, schema, opts)).valid).toBe(true)
    const r = await validateCore({ user: { name: 7 } }, schema, opts)
    expect(r.errors[0]?.instancePath).toBe('/user/name')
    expect(r.errors[0]?.schemaPath).toBe('#/$defs/user/properties/name/type')
    const r2 = await validateCore({ user: {} }, schema, opts)
    expect(r2.errors[0]?.code).toBe('required-missing')
  })

  it('supports ref to the root (#)', async () => {
    const schema = { type: 'object', properties: { self: { $ref: '#' } } }
    expect((await validateCore({ self: {} }, schema, opts)).valid).toBe(true)
    expect((await validateCore({ self: 5 }, schema, opts)).valid).toBe(false)
  })

  it('escaped pointer tokens in refs', async () => {
    const schema = {
      type: 'object',
      properties: { v: { $ref: '#/$defs/a~1b' } },
      $defs: { 'a/b': { type: 'integer' } },
    }
    expect((await validateCore({ v: 5 }, schema, opts)).valid).toBe(true)
    expect((await validateCore({ v: 'x' }, schema, opts)).valid).toBe(false)
  })

  it('missing ref target: strict → schema issue; lax → instance error', async () => {
    const schema = { type: 'object', properties: { v: { $ref: '#/$defs/nope' } } }
    const strict = await validateCore({ v: 1 }, schema, opts)
    expect(strict.valid).toBe(false)
    expect(strict.complete).toBe(false)
    expect(strict.schemaIssues.map((i) => i.code)).toContain('ref-missing')
    const laxR = await validateCore({ v: 1 }, schema, lax)
    expect(laxR.valid).toBeNull()
    expect(laxR.errors.map((e) => e.code)).toContain('ref-missing')
  })

  it('non-$defs ref form is rejected', async () => {
    const schema = { $ref: '#/properties/x' }
    const r = await validateCore(5, schema, opts)
    expect(r.schemaIssues.map((i) => i.code)).toContain('ref-invalid')
  })

  it('remote refs are rejected', async () => {
    const schema = { $ref: 'https://example.com/schema.json#/a' }
    const r = await validateCore(5, schema, opts)
    expect(r.schemaIssues.map((i) => i.code)).toContain('ref-invalid')
  })

  it('recursive schema progresses with instance structure', async () => {
    const schema = {
      type: 'object',
      properties: {
        value: { type: 'integer' },
        next: { anyOf: [{ $ref: '#' }, { type: 'null' }] },
      },
    }
    const good = { value: 1, next: { value: 2, next: { value: 3, next: null } } }
    expect((await validateCore(good, schema, opts)).valid).toBe(true)
    const bad = { value: 1, next: { value: 'x', next: null } }
    const r = await validateCore(bad, schema, opts)
    expect(r.valid).toBe(false)
    // 顶层失败在 /next（anyOf 全败）；分支细节定位到 /next/value
    expect(r.errors[0]?.code).toBe('any-of')
    expect(r.errors[0]?.instancePath).toBe('/next')
    expect(r.errors[0]?.branches?.[0]?.errors[0]?.instancePath).toBe('/next/value')
  })
})

describe('$ref cycles and chain depth', () => {
  it('pure $ref cycle: static schema issue (strict)', async () => {
    const schema = { $defs: { a: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' }
    const r = await validateCore(5, schema, opts)
    expect(r.valid).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.schemaIssues.map((i) => i.code)).toContain('ref-cycle')
  })

  it('pure $ref cycle: dynamic error in lax mode', async () => {
    const schema = { $defs: { a: { $ref: '#/$defs/a' } }, $ref: '#/$defs/a' }
    const r = await validateCore(5, schema, lax)
    expect(r.valid).toBeNull()
    expect(r.errors.map((e) => e.code)).toContain('ref-cycle')
  })

  it('two-node pure cycle is detected', async () => {
    const schema = {
      $defs: { a: { $ref: '#/$defs/b' }, b: { $ref: '#/$defs/a' } },
      $ref: '#/$defs/a',
    }
    const r = await validateCore(5, schema, opts)
    expect(r.schemaIssues.map((i) => i.code)).toContain('ref-cycle')
  })

  it('ref chain beyond 64 reports ref-depth', async () => {
    // 构造 70 个纯转发节点 a0 → a1 → ... → a69（最后一个落到 const）
    const defs: Record<string, unknown> = {}
    for (let i = 0; i < 69; i++) {
      defs[`a${i}`] = { $ref: `#/$defs/a${i + 1}` }
    }
    defs.a69 = { type: 'integer' }
    const schema = { $defs: defs, $ref: '#/$defs/a0' }
    const r = await validateCore(5, schema, opts)
    expect(r.schemaIssues.map((i) => i.code)).toContain('ref-depth')
    // 65 个转发节点（≤ 64 链）不报 ref-depth，且能正确验证
    const defs2: Record<string, unknown> = {}
    for (let i = 0; i < 63; i++) {
      defs2[`b${i}`] = { $ref: `#/$defs/b${i + 1}` }
    }
    defs2.b63 = { type: 'integer' }
    const okSchema = { $defs: defs2, $ref: '#/$defs/b0' }
    expect((await validateCore(5, okSchema, opts)).valid).toBe(true)
    expect((await validateCore('x', okSchema, opts)).valid).toBe(false)
  })

  it('$ref with sibling keywords applies both (draft 2020-12)', async () => {
    const schema = {
      $defs: { num: { type: 'integer' } },
      $ref: '#/$defs/num',
      minimum: 10,
    }
    expect((await validateCore(5, schema, opts)).valid).toBe(false) // < 10
    expect((await validateCore(15, schema, opts)).valid).toBe(true)
    expect((await validateCore('x', schema, opts)).valid).toBe(false)
  })
})
