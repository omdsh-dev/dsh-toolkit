import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply } from '../src/index.ts'

describe('calculator: plugin registration contract (AUDIT-CROSS-02)', () => {
  it('exports the cordis plugin contract', () => {
    expect(typeof name).toBe('string')
    expect(name).toBe('@deepseek-ai/dsh-tool-calculator')
    expect(inject).toContain('tools')
    expect(typeof apply).toBe('function')
  })

  it('registers the calculator tool with schema + render', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    expect(def.name).toBe('calculator')
    expect(def.parameters.expression.required).toBe(true)
    expect(typeof def.output.render).toBe('function')
    expect(def.timeoutMs).toBeGreaterThan(0)
  })
})
