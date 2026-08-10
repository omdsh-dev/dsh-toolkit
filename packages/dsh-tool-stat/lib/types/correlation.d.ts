/**
 * dsh-tool-stat correlation 核心计算 —— Pearson / Spearman。
 *
 * 契约（冻结，见 dsh-tool-stat-design.md §3.3）：
 * - Pearson：稳定的协方差/方差在线更新（Welford 风格）；
 *   任一序列零方差时返回 `defined: false, value: null, reason: 'zero-variance'`
 * - Spearman：对两个序列分别计算平均秩（ties 用 midrank），再对秩序列算 Pearson
 * - 计算结果返回前做有限数检查，溢出抛 `numeric-overflow` 错误
 *
 * 本模块不依赖 Cordis / dsh-tools；输入视为已通过 `validateStatArgs`
 * （等长、至少 2 项、有限），且不修改输入数组。
 */
import type { CorrelationMethod, CorrelationResult } from './types.ts';
/**
 * 1-based 平均秩（ties 取 midrank）。返回与原数组同序的秩数组；
 * 不修改输入（对副本排序）。
 */
export declare function midranks(values: number[]): number[];
/** correlation action。`method='spearman'` 时先对两序列分别做 midrank。 */
export declare function correlationValues(x: number[], y: number[], method: CorrelationMethod): CorrelationResult;
