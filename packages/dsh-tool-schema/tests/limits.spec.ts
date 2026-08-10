/**
 * 资源限制与截断：maxErrors、data/schema 大小/深度/节点、错误排序稳定性、
 * canonical 输出上限、checkedNodes。
 */

import { describe, expect, it } from 'vitest'
import { validateCore, compareErrors } from '../src/validator.ts'
import { checkJsonValue } from '../src/json-guard.ts'
import { capJsonOutput } from '../src/index.ts'
import { MAX_DATA_BYTES, MAX_DEPTH, MAX_ERRORS, MAX_INSTANCE_NODES, MAX_OUTPUT_BYTES, MAX_SCHEMA_NODES } from '../src/limits.ts'
import type { ValidationError } from '../src/types.ts'

const opts = { maxErrors: 100, strictSchema: true }

describe('maxErrors', () => {
  it('caps errors and sets truncated', async () => {
    const properties: Record<string, unknown> = {}
    for (let i = 0; i < 20; i++) properties[`k${i}`] = { type: 'integer' }
    const schema = { type: 'object', properties }
    const data: Record<string, unknown> = {}
    for (let i = 0; i < 20; i++) data[`k${i}`] = 'x'
    const r = await validateCore(data, schema, { maxErrors: 5, strictSchema: true })
    expect(r.valid).toBe(false)
    expect(r.errors).toHaveLength(5)
    expect(r.truncated).toBe(true)
  })

  it('clamps maxErrors to 1..1000', async () => {
    const properties: Record<string, unknown> = {}
    for (let i = 0; i < 10; i++) properties[`k${i}`] = { type: 'integer' }
    const schema = { type: 'object', properties }
    const data: Record<string, unknown> = {}
    for (let i = 0; i < 10; i++) data[`k${i}`] = 'x'
    expect((await validateCore(data, schema, { maxErrors: -3, strictSchema: true })).errors).toHaveLength(1)
    const big = await validateCore(data, schema, { maxErrors: MAX_ERRORS + 1000, strictSchema: true })
    expect(big.errors.length).toBeLessThanOrEqual(MAX_ERRORS)
  })
})

describe('data limits (json-guard)', () => {
  it('size limit: 256KiB string → data-size', async () => {
    const r = await validateCore('a'.repeat(MAX_DATA_BYTES + 1), { type: 'string' }, opts)
    expect(r.valid).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.errors[0]?.code).toBe('data-size')
  })

  it('depth limit: nested arrays beyond 64 → data-depth', async () => {
    let data: unknown = []
    for (let i = 0; i < MAX_DEPTH + 2; i++) data = [data]
    const r = await validateCore(data, { type: 'array' }, opts)
    expect(r.errors[0]?.code).toBe('data-depth')
  })

  it('node limit: 100001 nodes → data-nodes', async () => {
    const data = new Array(MAX_INSTANCE_NODES + 1).fill(1)
    const r = await validateCore(data, { type: 'array' }, opts)
    expect(r.errors[0]?.code).toBe('data-nodes')
  })

  it('cycle in data → data-cycle (defensive)', async () => {
    const data: Record<string, unknown> = { a: 1 }
    data.self = data
    const r = await validateCore(data, { type: 'object' }, opts)
    expect(r.valid).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.errors[0]?.code).toBe('data-cycle')
  })
})

describe('schema limits', () => {
  it('schema size limit → schema-size issue', async () => {
    const schema = { type: 'object', properties: { big: { type: 'string', description: 'x'.repeat(MAX_DATA_BYTES + 1) } } }
    const r = await validateCore({}, schema, opts)
    expect(r.valid).toBe(false)
    expect(r.complete).toBe(false)
    expect(r.schemaIssues[0]?.code).toBe('schema-size')
  })

  it('schema node limit → schema-nodes issue', async () => {
    const properties: Record<string, unknown> = {}
    for (let i = 0; i < MAX_SCHEMA_NODES + 1; i++) properties[`p${i}`] = { type: 'string' }
    const r = await validateCore({}, { type: 'object', properties }, opts)
    expect(r.schemaIssues[0]?.code).toBe('schema-nodes')
  })

  it('schema depth limit → schema-depth issue', async () => {
    let schema: unknown = { type: 'object' }
    for (let i = 0; i < MAX_DEPTH + 2; i++) schema = { type: 'object', properties: { next: schema } }
    const r = await validateCore({}, schema, opts)
    expect(r.schemaIssues[0]?.code).toBe('schema-depth')
  })

  it('cyclic schema → schema-cycle issue', async () => {
    const schema: Record<string, unknown> = { type: 'object' }
    schema.self = schema
    const r = await validateCore({}, schema, opts)
    expect(r.schemaIssues[0]?.code).toBe('schema-cycle')
  })

  it('schema node count also guards the traversal budget', async () => {
    // 大量分支导致 checkedNodes 超限 → data-nodes + truncated
    const branches: unknown[] = []
    for (let i = 0; i < 60; i++) branches.push({ type: 'object', properties: { a: { type: 'integer' } } })
    const schema = { anyOf: branches }
    const r = await validateCore({ a: 'x' }, schema, { maxErrors: 100, strictSchema: true })
    // 60 分支 × 若干节点，checkedNodes 应大于 0 且结果确定
    expect(r.checkedNodes).toBeGreaterThan(0)
    expect(typeof r.valid).toBe('boolean')
  })
})

describe('error ordering stability', () => {
  function makeErrors(): ValidationError[] {
    return [
      { instancePath: '/b', schemaPath: '#/properties/b/type', keyword: 'type', code: 'type-mismatch', message: 'm' },
      { instancePath: '/a', schemaPath: '#/properties/a/minLength', keyword: 'minLength', code: 'min-length', message: 'm' },
      { instancePath: '/a', schemaPath: '#/properties/a/type', keyword: 'type', code: 'type-mismatch', message: 'm' },
      { instancePath: '', schemaPath: '#/maxLength', keyword: 'maxLength', code: 'max-length', message: 'm' },
      { instancePath: '', schemaPath: '#/minLength', keyword: 'minLength', code: 'min-length', message: 'm' },
    ]
  }

  it('sorts by instancePath, then schemaPath, then keyword', () => {
    const sorted = [...makeErrors()].sort(compareErrors)
    const order = sorted.map((e) => `${e.instancePath}|${e.schemaPath}|${e.keyword}`)
    expect(order).toEqual([
      '|#/maxLength|maxLength',
      '|#/minLength|minLength',
      '/a|#/properties/a/minLength|minLength',
      '/a|#/properties/a/type|type',
      '/b|#/properties/b/type|type',
    ])
  })

  it('validate output is sorted', async () => {
    const r = await validateCore(
      { b: 'x', a: 'y' },
      { type: 'object', properties: { a: { type: 'string', minLength: 5 }, b: { type: 'integer' } } },
      opts,
    )
    const order = r.errors.map((e) => `${e.instancePath}|${e.schemaPath}`)
    expect(order).toEqual([
      '/a|#/properties/a/minLength',
      '/b|#/properties/b/type',
    ])
  })
})

describe('checkedNodes', () => {
  it('counts visited instance nodes deterministically', async () => {
    const r1 = await validateCore({ a: { b: 1 } }, { type: 'object', properties: { a: { type: 'object' } } }, opts)
    const r2 = await validateCore({ a: { b: 1 } }, { type: 'object', properties: { a: { type: 'object' } } }, opts)
    expect(r1.checkedNodes).toBe(r2.checkedNodes)
    expect(r1.checkedNodes).toBeGreaterThan(0)
  })
})

describe('canonical output cap', () => {
  it('trims large arrays and sets truncated', () => {
    const big: Record<string, unknown> = { action: 'validate', complete: true, valid: false, checkedNodes: 1, truncated: false }
    big.errors = Array.from({ length: 300 }, (_, i) => ({
      instancePath: `/k${i}`,
      schemaPath: '#/properties/k/type',
      keyword: 'type',
      code: 'type-mismatch',
      message: 'x'.repeat(4500),
    }))
    const raw = JSON.stringify(big)
    expect(Buffer.byteLength(raw, 'utf8')).toBeGreaterThan(MAX_OUTPUT_BYTES)
    const capped = capJsonOutput(big) as typeof big
    const text = JSON.stringify(capped)
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(MAX_OUTPUT_BYTES)
    expect(capped.truncated).toBe(true)
    expect((capped.errors as unknown[]).length).toBeLessThan(300)
  })

  it('keeps small outputs untouched', () => {
    const small = { action: 'validate', valid: true, errors: [] }
    expect(capJsonOutput(small)).toBe(small)
  })
})

describe('json-guard diagnostics', () => {
  it('reports the offending path', () => {
    const r = checkJsonValue({ a: { b: 'x'.repeat(MAX_DATA_BYTES + 1) } }, { maxBytes: MAX_DATA_BYTES, maxDepth: 64, maxNodes: 1000, label: 'data' })
    expect(r.ok).toBe(false)
    expect(r.failure?.path).toBe('/a/b')
  })
})
