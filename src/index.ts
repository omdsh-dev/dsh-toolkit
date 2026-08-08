/**
 * DSH 零依赖工具包 collection —— 统一入口。
 *
 * 聚合注册 6 个工具（time / encoding / json / calculator / csv / regex）。
 * 子包在 packages/ 下 vendored（发布态快照，各子仓库独立演进）；
 * 采用相对路径动态导入（方案 A 的工程化适配：子包为私有未发布包，
 * peer 名解析在 profile 内不可行，相对导入零解析魔法且打包自足）。
 *
 * 原子性（审查 TK-06 修复）：apply 期间包装 ctx.tools.register 捕获 disposer；
 * 任一子插件注册/apply 失败时，逆序回滚已注册工具并恢复原始 register——
 * 不留下"部分工具已注册"的非一致状态。
 *
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-kit
 *     name: '@deepseek-ai/dsh-toolkit'
 */

import type { Context } from 'cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

interface SubPlugin {
  name: string
  inject: string[]
  apply: (ctx: Context) => void
}

const SUBPLUGINS = [
  'dsh-tool-time',
  'dsh-tool-encoding',
  'dsh-tool-json',
  'dsh-tool-calculator',
  'dsh-tool-csv',
  'dsh-tool-regex',
] as const

async function loadSubPlugins(): Promise<SubPlugin[]> {
  return Promise.all(SUBPLUGINS.map(async n => {
    const mod = await import(`../packages/${n}/lib/index.js`)
    return mod as unknown as SubPlugin
  }))
}

export const name = '@deepseek-ai/dsh-toolkit'
export const inject = ['tools']

export async function apply(ctx: Context): Promise<void> {
  const plugins = await loadSubPlugins()
  const disposers: Array<() => void> = []
  const originalRegister = ctx.tools.register
  let patched = false
  try {
    // 包装 register 捕获 disposer，用于失败回滚
    ctx.tools.register = ((def: ToolDefinition): (() => void) => {
      const dispose = originalRegister.call(ctx.tools, def)
      disposers.push(dispose)
      return dispose
    }) as typeof ctx.tools.register
    patched = true
    for (const p of plugins) {
      p.apply(ctx)
    }
  } catch (error) {
    // 逆序回滚已注册工具
    for (const dispose of [...disposers].reverse()) {
      try {
        dispose()
      } catch {
        // 回滚失败不掩盖原始错误
      }
    }
    throw new Error(`dsh-toolkit: failed to apply subplugins (${disposers.length} rolled back): ${String((error as Error).message)}`)
  } finally {
    if (patched) ctx.tools.register = originalRegister
  }
}
