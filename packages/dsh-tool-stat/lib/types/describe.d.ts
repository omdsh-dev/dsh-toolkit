/**
 * dsh-tool-stat describe / percentile 核心计算。
 *
 * 算法（冻结，见 dsh-tool-stat-design.md §3.3）：
 * - `sum`：Neumaier compensated summation（对大小数量级混合输入保持精度）
 * - `mean`：compensated sum / n
 * - `variance`：Welford 在线算法（一次遍历同时得到 mean 与 M2）
 * - 百分位：线性插值 `h=(n-1)*p`，位于 `floor(h)` 与 `ceil(h)` 之间插值；
 *   q1/median/q3 分别等于 25/50/75 百分位
 * - 所有数值结果返回前做有限数检查，溢出抛 `numeric-overflow` 错误
 *
 * 本模块不依赖 Cordis / dsh-tools；输入视为已通过 `validateStatArgs`
 * （有限、长度 1..100000、-0 已归一化），且不修改输入数组。
 */
import type { DescribeResult, PercentileResult } from './types.ts';
/** Neumaier compensated summation。 */
export declare function compensatedSum(values: number[]): number;
/** Welford 在线均值/二阶矩：返回 mean 与 M2（Σ(x-mean)²）。 */
export declare function welford(values: number[]): {
    mean: number;
    m2: number;
};
/**
 * 升序排序副本（不修改输入）。`a - b` 对有限 number 安全。
 */
export declare function sortedCopy(values: number[]): number[];
/**
 * 线性插值百分位。`sorted` 必须已升序；`p` 为分位数（0..1）。
 * `h=(n-1)*p`，位于 `floor(h)` 与 `ceil(h)` 之间插值。
 */
export declare function percentileAt(sorted: number[], p: number): number;
/** describe action。`sample=false` 用 n 分母，`sample=true` 用 n-1 分母。 */
export declare function describeValues(values: number[], sample: boolean): DescribeResult;
/** percentile action。输出保持调用方传入顺序，重复项不去重。 */
export declare function percentileValues(values: number[], percentiles: number[]): PercentileResult;
