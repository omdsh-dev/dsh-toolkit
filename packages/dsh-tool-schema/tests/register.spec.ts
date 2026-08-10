/**
 * 插件注册契约（AUDIT-CROSS-02 风格）+ 工具级 action 分发：
 * defineTool 注册（name/parameters/output/render/timeoutMs）、非 async execute、
 * data 必填规则（null 合法）、strictSchema 默认 true、maxErrors 钳制、
 * canonical JSON 输出。
 */

import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply } from '../src/index.ts'

describe('schema: plugin registration contract (AUDIT-CROSS-02)', () => {
  it('exports the cordis plugin contract', () => {
    expect(typeof name).toBe('string')
    expect(name).toBe('@deepseek-ai/dsh-tool-schema')
    expect(inject).toContain('tools')
    expect(typeof apply).toBe('function')
  })

  it('registers the schema tool with json output + render', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    expect(def.name).toBe('schema')
    expect(def.parameters.action.required).toBe(true)
    expect(def.parameters.action.enum).toEqual(['validate', 'paths', 'explain', 'normalize'])
    expect(def.parameters.schema.required).toBe(true)
    expect(def.parameters.data.type).toBe('json')
    expect(def.parameters.strictSchema.type).toBe('boolean')
    expect(def.parameters.maxErrors.type).toBe('integer')
    expect(def.output.schema.type).toBe('json')
    expect(typeof def.output.render).toBe('function')
    expect(def.timeoutMs).toBe(3000)
    // execute 是非 async 函数：同步返回 Promise.resolve
    expect(def.execute.constructor.name).toBe('Function')
    const p = def.execute({ action: 'explain', schema: { type: 'string' } })
    expect(p).toBeInstanceOf(Promise)
  })

  it('render stringifies the canonical JSON value', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    const blocks = def.output.render({}, { action: 'validate', valid: true })
    expect(blocks).toEqual([{ type: 'text', text: JSON.stringify({ action: 'validate', valid: true }) }])
  })
})

describe('schema: action dispatch through the tool definition', () => {
  function tool() {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    return captured as any
  }

  it('validate returns canonical JSON output', async () => {
    const def = tool()
    const result = await def.execute({ action: 'validate', data: { age: 'x' }, schema: { type: 'object', properties: { age: { type: 'integer' } } } })
    expect(result).toMatchObject({
      action: 'validate',
      complete: true,
      valid: false,
      errors: [{ instancePath: '/age', schemaPath: '#/properties/age/type', keyword: 'type', code: 'type-mismatch' }],
      schemaIssues: [],
      truncated: false,
    })
  })

  it('null is valid data', async () => {
    const def = tool()
    const result = await def.execute({ action: 'validate', data: null, schema: { type: 'null' } })
    expect(result.valid).toBe(true)
  })

  it('missing data rejects for validate', async () => {
    const def = tool()
    await expect(def.execute({ action: 'validate', schema: {} })).rejects.toThrow('requires "data"')
    await expect(def.execute({ action: 'paths', schema: {} })).rejects.toThrow('requires "data"')
    await expect(def.execute({ action: 'normalize', schema: {} })).rejects.toThrow('requires "data"')
  })

  it('explain does not require data', async () => {
    const def = tool()
    const result = await def.execute({ action: 'explain', schema: { type: 'object', required: ['name'] } })
    expect(result.action).toBe('explain')
    expect(result.nodes[0]?.schemaPath).toBe('#')
  })

  it('strictSchema defaults to true', async () => {
    const def = tool()
    const result = await def.execute({ action: 'validate', data: {}, schema: { type: 'object', contains: {} } })
    expect(result.valid).toBe(false)
    expect(result.complete).toBe(false)
    expect(result.schemaIssues[0]?.code).toBe('unsupported-keyword')
  })

  it('strictSchema=false validates the supported subset with valid=null', async () => {
    const def = tool()
    const result = await def.execute({ action: 'validate', data: { a: 1 }, schema: { type: 'object', properties: { a: { type: 'integer' } }, contains: {} }, strictSchema: false })
    expect(result.valid).toBeNull()
    expect(result.complete).toBe(false)
    expect(result.supportedSubsetValid).toBe(true)
    expect(result.schemaIssues[0]?.code).toBe('unsupported-keyword')
  })

  it('maxErrors clamps to the documented range', async () => {
    const def = tool()
    const properties: Record<string, unknown> = {}
    const data: Record<string, unknown> = {}
    for (let i = 0; i < 10; i++) {
      properties[`k${i}`] = { type: 'integer' }
      data[`k${i}`] = 'x'
    }
    const result = await def.execute({ action: 'validate', data, schema: { type: 'object', properties }, maxErrors: 2 })
    expect(result.errors).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  it('paths groups errors by path with sorted keywords', async () => {
    const def = tool()
    const result = await def.execute({
      action: 'paths',
      data: { a: 'x', b: 'y' },
      schema: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } } },
    })
    expect(result.action).toBe('paths')
    expect(result.valid).toBe(false)
    expect(result.errorCount).toBe(2)
    expect(result.paths).toEqual([
      { path: '/a', keywords: ['type'] },
      { path: '/b', keywords: ['type'] },
    ])
  })

  it('normalize through the tool definition', async () => {
    const def = tool()
    const result = await def.execute({
      action: 'normalize',
      data: { name: 'A' },
      schema: { type: 'object', properties: { name: { type: 'string' }, enabled: { type: 'boolean', default: true } } },
    })
    expect(result.action).toBe('normalize')
    expect(result.valid).toBe(true)
    expect(result.value).toEqual({ name: 'A', enabled: true })
    expect(result.appliedDefaults).toEqual(['/enabled'])
  })

  it('boolean schemas are accepted as schema param', async () => {
    const def = tool()
    expect((await def.execute({ action: 'validate', data: 1, schema: true })).valid).toBe(true)
    expect((await def.execute({ action: 'validate', data: 1, schema: false })).valid).toBe(false)
  })
})
