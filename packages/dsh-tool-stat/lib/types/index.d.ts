/**
 * DSH 统计工具插件。
 *
 * 注册 `stat` 工具：描述统计、百分位数、频数分布、相关性计算。
 * 接入方式：在 cordis.yml 追加：
 *   - id: tool-stat
 *     name: '@deepseek-ai/dsh-tool-stat'
 *
 * 契约（冻结，见 dsh-tool-stat-design.md）：
 * - 4 个 action：describe / percentile / frequency / correlation
 * - 只接受显式传入的有限数值数组；拒绝 NaN / Infinity；-0 规范化为 0
 * - 数值稳定性：Neumaier 补偿求和、Welford 方差、线性插值百分位、Spearman midrank
 * - 结果返回前再次有限数检查，溢出抛 `numeric-overflow` 错误，
 *   绝不让 canonical JSON 输出包含 Infinity / NaN
 * - 资源边界：最大 100000 观测、100 个百分位数、10000 distinct 输出；timeoutMs 2000
 * - 不读取文件、不访问网络、不创建进程、不保存状态；不修改输入数组
 */
import type { Context } from '@deepseek-ai/cordis';
import type { StatResult } from './types.ts';
export declare const name = "@deepseek-ai/dsh-tool-stat";
export declare const inject: string[];
/**
 * `stat` 工具入口：校验参数后按 action 分发。
 * 校验失败抛 `stat: ...` 错误；计算结果溢出抛 `numeric-overflow` 错误。
 */
export declare function runStatAction(args: unknown): StatResult;
export declare function apply(ctx: Context): void;
