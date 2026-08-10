/**
 * dsh-tool-stat 结果类型（canonical JSON 输出形状）。
 *
 * 所有数值字段都保证是有限 number（-0 已规范化为 0）；实现层在返回前
 * 再次做有限数检查，任何溢出都抛 `numeric-overflow` 错误，绝不让输出
 * 携带 Infinity / NaN。
 */
export type StatAction = 'describe' | 'percentile' | 'frequency' | 'correlation';
export type CorrelationMethod = 'pearson' | 'spearman';
/** `stat` 工具运行时参数（JSON schema 校验后的语义形态）。 */
export interface StatArgs {
    action: StatAction;
    values: number[];
    other?: number[];
    percentiles?: number[];
    method?: CorrelationMethod;
    sample?: boolean;
}
export interface DescribeResult {
    action: 'describe';
    count: number;
    sum: number;
    min: number;
    max: number;
    mean: number;
    median: number;
    variance: number;
    standardDeviation: number;
    q1: number;
    q3: number;
    iqr: number;
    sample: boolean;
}
export interface PercentileEntry {
    percentile: number;
    value: number;
}
export interface PercentileResult {
    action: 'percentile';
    count: number;
    /** 保持调用方传入顺序；重复百分位不自动去重。 */
    percentiles: PercentileEntry[];
}
export interface FrequencyEntry {
    value: number;
    count: number;
    /** 分母始终是原始观测数（截断时总和不为 1，需看 returnedRatio）。 */
    ratio: number;
}
export interface FrequencyResult {
    action: 'frequency';
    count: number;
    distinctTotal: number;
    distinctReturned: number;
    truncated: boolean;
    /** 已返回项的 ratio 总和（截断时 < 1）。 */
    returnedRatio: number;
    entries: FrequencyEntry[];
}
export interface CorrelationResult {
    action: 'correlation';
    method: CorrelationMethod;
    count: number;
    defined: boolean;
    value: number | null;
    reason: string | null;
}
export type StatResult = DescribeResult | PercentileResult | FrequencyResult | CorrelationResult;
