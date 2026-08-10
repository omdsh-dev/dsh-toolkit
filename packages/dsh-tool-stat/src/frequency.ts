/**
 * dsh-tool-stat frequency 核心计算 —— 数值频数分布。
 *
 * 契约（冻结，见 dsh-tool-stat-design.md §3.3）：
 * - 按数值严格相等分组（`-0` 已由校验层归一化为 `0`）
 * - 输出按数值升序；每项返回 `value` / `count` / `ratio`
 * - `ratio` 分母始终是原始观测数，不是截断后的计数
 * - distinct 项最多输出 10000：超过时先按 count 降序、再按 value 升序
 *   选择前 10000 项，最后按数值升序稳定呈现，并返回 `truncated: true`、
 *   `distinctTotal`、`distinctReturned`、`returnedRatio`
 *
 * 本模块不依赖 Cordis / dsh-tools；输入视为已通过 `validateStatArgs`。
 */

import type { FrequencyEntry, FrequencyResult } from './types.ts'
import { MAX_DISTINCT, normalizeZero } from './validate.ts'

/** frequency action。`values` 视为已校验（有限、非空）。 */
export function frequencyValues(values: number[]): FrequencyResult {
  const counts = new Map<number, number>()
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1)
  }

  const total = values.length
  const entries: FrequencyEntry[] = []
  for (const [value, count] of counts) {
    const ratio = count / total
    if (!Number.isFinite(ratio)) {
      throw new Error('stat: numeric-overflow: frequency produced a non-finite ratio')
    }
    entries.push({ value: normalizeZero(value), count, ratio })
  }

  const truncated = entries.length > MAX_DISTINCT
  let selected: FrequencyEntry[]
  if (truncated) {
    // 先按 count 降序、再按 value 升序选择前 MAX_DISTINCT 项
    selected = entries
      .slice()
      .sort((a, b) => b.count - a.count || a.value - b.value)
      .slice(0, MAX_DISTINCT)
  } else {
    selected = entries
  }
  // 最终按数值升序稳定呈现
  selected.sort((a, b) => a.value - b.value)

  let returnedRatio = 0
  for (const e of selected) returnedRatio += e.ratio

  return {
    action: 'frequency',
    count: total,
    distinctTotal: entries.length,
    distinctReturned: selected.length,
    truncated,
    returnedRatio,
    entries: selected,
  }
}
