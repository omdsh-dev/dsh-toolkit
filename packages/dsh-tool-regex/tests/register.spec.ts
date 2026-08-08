import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply } from '../src/index.ts'

describe('regex: plugin registration contract (AUDIT-CROSS-02)', () => {
  it('exports the cordis plugin contract', () => {
    expect(typeof name).toBe('string')
    expect(name).toBe('@deepseek-ai/dsh-tool-regex')
    expect(inject).toContain('tools')
    expect(typeof apply).toBe('function')
  })

  it('registers the regex tool with schema + render', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    expect(def.name).toBe('regex')
    expect(def.parameters.action.required).toBe(true)
    expect(def.parameters.action.enum).toEqual(['test', 'find', 'replace', 'explain'])
    expect(def.parameters.pattern.required).toBe(true)
    expect(def.parameters.limit.type).toBe('integer')
    expect(typeof def.output.render).toBe('function')
    expect(def.output.schema.type).toBe('string')
    expect(def.timeoutMs).toBeGreaterThan(0)
  })
})
