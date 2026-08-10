/**
 * dsh-tool-stat 参数语义校验 —— 资源边界、有限数、-0 归一化、action 语义。
 *
 * 契约（冻结，见 dsh-tool-stat-design.md §3.2）：
 * - `values` 长度 1..100000，全部为有限 number；`-0` 规范化为 `0`
 * - `other` 仅用于 correlation：长度与 `values` 相同且至少为 2
 * - `percentiles` 1..100 项，每项 0..100，全部有限
 * - `method` 默认 `pearson`；`sample` 默认 `false`
 * - `sample=true` 且需要 n-1 分母时（describe）至少 2 个值
 *
 * 本模块不依赖 Cordis / dsh-tools，可独立单测。校验不修改调用方传入的数组。
 */
import type { CorrelationMethod, StatAction } from './types.ts';
/** 最大观测数（主保险丝；同步 CPU 计算无法被协作式 timeout 真正中断）。 */
export declare const MAX_OBSERVATIONS = 100000;
/** 单次最多请求的百分位数个数。 */
export declare const MAX_PERCENTILES = 100;
/** frequency 最多输出的 distinct 项数。 */
export declare const MAX_DISTINCT = 10000;
/** 校验通过后的规范化参数形态。 */
export interface NormalizedArgs {
    action: StatAction;
    /** -0 已归一化为 0 的副本（不修改调用方数组）。 */
    values: number[];
    /** 仅 correlation 存在；长度与 values 相同。 */
    other?: number[];
    /** 仅 percentile 存在；1..100 项，每项 0..100。 */
    percentiles: number[];
    method: CorrelationMethod;
    sample: boolean;
}
/** `-0` 规范化为 `0`；其余原样返回。 */
export declare function normalizeZero(v: number): number;
/**
 * 校验 `stat` 工具参数并返回规范化形态。任何违规抛 `stat: ...` 错误。
 * 输入数组只读：返回值携带的是归一化副本。
 */
export declare function validateStatArgs(args: unknown): NormalizedArgs;
