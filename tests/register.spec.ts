import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply } from '../src/index.ts'

function makeCtx(failAt: string | null): {
  ctx: any
  registered: string[]
  disposed: string[]
} {
  const registered: string[] = []
  const disposed: string[] = []
  const ctx = {
    tools: {
      register: (def: { name: string }) => {
        if (def.name === failAt) throw new Error(`duplicate tool "${def.name}"`)
        registered.push(def.name)
        return () => { disposed.push(def.name) }
      },
    },
  }
  return { ctx, registered, disposed }
}

describe('dsh-toolkit: meta 契约（审查 TK-06 原子性）', () => {
  it('exports the cordis plugin contract', () => {
    expect(typeof name).toBe('string')
    expect(name).toBe('@deepseek-ai/dsh-toolkit')
    expect(inject).toContain('tools')
  })

  it('registers all 10 tools through apply (real subplugin modules)', async () => {
    const { ctx, registered, disposed } = makeCtx(null)
    await apply(ctx)
    expect(registered).toEqual([
      'time', 'encoding', 'json', 'calculator', 'csv',
      'regex', 'markdown', 'diff', 'stat', 'schema',
    ])
    expect(disposed).toEqual([])
  })

  it('rolls back all prior registrations when a later subplugin fails (TK-06)', async () => {
    const { ctx, registered, disposed } = makeCtx('csv')
    await expect(apply(ctx)).rejects.toThrow(/failed to apply subplugins \(4 rolled back\)/)
    expect(registered).toEqual(['time', 'encoding', 'json', 'calculator'])
    // 逆序回滚：calculator → json → encoding → time
    expect(disposed).toEqual(['calculator', 'json', 'encoding', 'time'])
  })
})
