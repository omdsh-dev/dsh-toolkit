/**
 * DSH 零依赖工具包 collection —— 统一入口。
 *
 * 聚合注册 10 个工具（time / encoding / json / calculator / csv / regex / markdown / diff / stat / schema）。
 * 子包在 packages/ 下 vendored（pack artifact 快照，各子仓库独立演进）；
 * 采用相对路径动态导入（方案 A 的工程化适配：子包为私有 Git/collection 包，
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
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "@deepseek-ai/dsh-toolkit";
export declare const inject: string[];
export declare function apply(ctx: Context): Promise<void>;
