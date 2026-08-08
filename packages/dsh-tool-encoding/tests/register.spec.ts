import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply } from '../src/index.ts'

describe('encoding: plugin registration contract (AUDIT-CROSS-02)', () => {
  it('exports the cordis plugin contract', () => {
    expect(name).toBe('@deepseek-ai/dsh-tool-encoding')
    expect(inject).toContain('tools')
    expect(typeof apply).toBe('function')
  })

  it('registers the encoding tool with schema + render', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    expect(def.name).toBe('encoding')
    expect(def.parameters.action.required).toBe(true)
    expect(def.parameters.action.enum).toContain('uuid')
    expect(def.parameters.action.enum).toContain('hash')
    expect(typeof def.output.render).toBe('function')
    expect(def.timeoutMs).toBeGreaterThan(0)
  })
})
