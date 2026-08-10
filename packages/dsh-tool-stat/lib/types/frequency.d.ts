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
import type { FrequencyResult } from './types.ts';
/** frequency action。`values` 视为已校验（有限、非空）。 */
export declare function frequencyValues(values: number[]): FrequencyResult;
