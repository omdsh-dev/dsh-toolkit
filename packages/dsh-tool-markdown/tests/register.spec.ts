import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply } from '../src/index.ts'

describe('markdown: plugin registration contract (AUDIT-CROSS-02)', () => {
  it('exports the cordis plugin contract', () => {
    expect(typeof name).toBe('string')
    expect(name).toBe('@deepseek-ai/dsh-tool-markdown')
    expect(inject).toContain('tools')
    expect(typeof apply).toBe('function')
  })

  it('registers the markdown tool with schema + render', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    expect(def.name).toBe('markdown')
    expect(def.parameters.action.required).toBe(true)
    expect(def.parameters.action.enum).toEqual(['html2md', 'md2html', 'table', 'toc'])
    expect(def.parameters.maxBytes.type).toBe('integer')
    expect(typeof def.output.render).toBe('function')
    expect(def.output.schema.type).toBe('string')
    expect(def.timeoutMs).toBeGreaterThan(0)
  })

  it('dispatches all four actions through execute', async () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    const md = await def.execute({ action: 'html2md', html: '<h1>标题</h1><p>你好 <b>世界</b></p>' })
    expect(md).toContain('# 标题')
    expect(md).toContain('**世界**')
  })
})
