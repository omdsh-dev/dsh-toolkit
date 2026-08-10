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

import type { DescribeResult, PercentileResult } from './types.ts'
import { normalizeZero } from './validate.ts'

/** Neumaier compensated summation。 */
export function compensatedSum(values: number[]): number {
  let sum = 0
  let compensation = 0
  for (const v of values) {
    const t = sum + v
    if (Math.abs(sum) >= Math.abs(v)) {
      compensation += (sum - t) + v
    } else {
      compensation += (v - t) + sum
    }
    sum = t
  }
  return sum + compensation
}

/** Welford 在线均值/二阶矩：返回 mean 与 M2（Σ(x-mean)²）。 */
export function welford(values: number[]): { mean: number; m2: number } {
  let count = 0
  let mean = 0
  let m2 = 0
  for (const v of values) {
    count++
    const delta = v - mean
    mean += delta / count
    m2 += delta * (v - mean)
  }
  return { mean, m2 }
}

/**
 * 升序排序副本（不修改输入）。`a - b` 对有限 number 安全。
 */
export function sortedCopy(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

/**
 * 线性插值百分位。`sorted` 必须已升序；`p` 为分位数（0..1）。
 * `h=(n-1)*p`，位于 `floor(h)` 与 `ceil(h)` 之间插值。
 */
export function percentileAt(sorted: number[], p: number): number {
  const n = sorted.length
  if (n === 0) throw new Error('stat: percentile requires at least 1 value')
  if (p < 0 || p > 1) throw new Error('stat: percentile must be within 0..100')
  // n >= 1 时 sorted[0] 在界内；lo/hi 由 h=(n-1)*p ∈ [0, n-1] 保证在界内
  if (n === 1) return sorted[0]!
  const h = (n - 1) * p
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  if (lo === hi) return sorted[lo]!
  const weight = h - lo
  return sorted[lo]! * (1 - weight) + sorted[hi]! * weight
}

function assertFinite(fields: Record<string, number>, what: string): void {
  for (const [name, v] of Object.entries(fields)) {
    if (!Number.isFinite(v)) {
      throw new Error(`stat: numeric-overflow: ${what} produced a non-finite ${name}`)
    }
  }
}

/** describe action。`sample=false` 用 n 分母，`sample=true` 用 n-1 分母。 */
export function describeValues(values: number[], sample: boolean): DescribeResult {
  const n = values.length
  const sum = compensatedSum(values)
  // 设计契约：均值由 compensated sum / n 得到；Welford 仅用于方差（M2）
  const mean = sum / n
  const { m2 } = welford(values)
  const variance = m2 / (sample ? n - 1 : n)
  const sorted = sortedCopy(values)
  const q1 = percentileAt(sorted, 0.25)
  const median = percentileAt(sorted, 0.5)
  const q3 = percentileAt(sorted, 0.75)
  const standardDeviation = Math.sqrt(variance)
  const iqr = q3 - q1
  assertFinite({ sum, mean, variance, standardDeviation, q1, median, q3, iqr }, 'describe')
  return {
    action: 'describe',
    count: n,
    sum: normalizeZero(sum),
    min: normalizeZero(sorted[0]!),
    max: normalizeZero(sorted[n - 1]!),
    mean: normalizeZero(mean),
    median: normalizeZero(median),
    variance: normalizeZero(variance),
    standardDeviation: normalizeZero(standardDeviation),
    q1: normalizeZero(q1),
    q3: normalizeZero(q3),
    iqr: normalizeZero(iqr),
    sample,
  }
}

/** percentile action。输出保持调用方传入顺序，重复项不去重。 */
export function percentileValues(values: number[], percentiles: number[]): PercentileResult {
  const sorted = sortedCopy(values)
  const entries = percentiles.map((p) => ({
    percentile: normalizeZero(p),
    value: normalizeZero(percentileAt(sorted, p / 100)),
  }))
  for (const e of entries) {
    if (!Number.isFinite(e.value)) {
      throw new Error('stat: numeric-overflow: percentile produced a non-finite value')
    }
  }
  return { action: 'percentile', count: values.length, percentiles: entries }
}
