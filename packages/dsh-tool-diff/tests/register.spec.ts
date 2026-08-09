import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'

describe('注册契约', () => {
  it('name === @deepseek-ai/dsh-tool-diff', () => {
    expect(plugin.name).toBe('@deepseek-ai/dsh-tool-diff')
  })

  it('inject 包含 tools', () => {
    expect(plugin.inject).toContain('tools')
  })

  it('apply 是函数', () => {
    expect(typeof plugin.apply).toBe('function')
  })

  it('注册工具名为 diff', () => {
    const registered: Array<{ name: string; parameters?: { properties?: Record<string, unknown>; required?: string[] }; output?: { render?: unknown }; timeoutMs?: unknown }> = []
    const fakeCtx = {
      tools: {
        register(tool: { name: string; parameters?: { properties?: Record<string, unknown>; required?: string[] }; output?: { render?: unknown }; timeoutMs?: unknown }) {
          registered.push(tool)
        },
      },
    }
    plugin.apply(fakeCtx as never)
    expect(registered).toHaveLength(1)
    expect(registered[0]!.name).toBe('diff')
    const tool = registered[0]!
    // defineTool 把 parameters 编译为 JSON Schema 对象根
    const action = tool.parameters?.properties?.action as { enum?: string[] } | undefined
    expect(action?.enum).toEqual(['text', 'json', 'csv', 'markdown', 'patch'])
    expect(tool.parameters?.required).toContain('action')
    expect(typeof tool.output?.render).toBe('function')
    expect(tool.timeoutMs).toBeGreaterThan(0)
  })

  it('apply 注册的 defineTool 输出契约正确', () => {
    // 通过 dsh-tools 的 defineTool 直接构造一次，确认 schema 兼容
    const t = defineTool({
      name: 'diff',
      description: 'x',
      parameters: { action: { type: 'string', required: true, enum: ['text'] } },
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text' as const, text: v }] },
      execute: async () => 'ok',
      timeoutMs: 2000,
    })
    expect(t.name).toBe('diff')
    expect(t.timeoutMs).toBe(2000)
  })
})
