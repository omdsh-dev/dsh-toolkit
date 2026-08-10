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

import type { CorrelationMethod, StatAction } from './types.ts'

/** 最大观测数（主保险丝；同步 CPU 计算无法被协作式 timeout 真正中断）。 */
export const MAX_OBSERVATIONS = 100000
/** 单次最多请求的百分位数个数。 */
export const MAX_PERCENTILES = 100
/** frequency 最多输出的 distinct 项数。 */
export const MAX_DISTINCT = 10000

/** 校验通过后的规范化参数形态。 */
export interface NormalizedArgs {
  action: StatAction
  /** -0 已归一化为 0 的副本（不修改调用方数组）。 */
  values: number[]
  /** 仅 correlation 存在；长度与 values 相同。 */
  other?: number[]
  /** 仅 percentile 存在；1..100 项，每项 0..100。 */
  percentiles: number[]
  method: CorrelationMethod
  sample: boolean
}

/** `-0` 规范化为 `0`；其余原样返回。 */
export function normalizeZero(v: number): number {
  return Object.is(v, -0) ? 0 : v
}

function checkFiniteNumbers(arr: unknown, what: string): asserts arr is number[] {
  if (!Array.isArray(arr)) throw new Error(`stat: ${what} must be an array of numbers`)
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new Error(`stat: ${what}[${i}] must be a finite number (got ${String(v)})`)
    }
  }
}

/** 复制并把 -0 归一化为 0（不修改输入数组）。 */
function normalizedCopy(arr: number[]): number[] {
  const out = new Array<number>(arr.length)
  // i < arr.length 保证下标在界内
  for (let i = 0; i < arr.length; i++) out[i] = normalizeZero(arr[i]!)
  return out
}

const ACTIONS: readonly StatAction[] = ['describe', 'percentile', 'frequency', 'correlation']

/**
 * 校验 `stat` 工具参数并返回规范化形态。任何违规抛 `stat: ...` 错误。
 * 输入数组只读：返回值携带的是归一化副本。
 */
export function validateStatArgs(args: unknown): NormalizedArgs {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error('stat: args must be an object')
  }
  const raw = args as Record<string, unknown>

  const action = raw.action
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
    throw new Error(`stat: unknown action ${JSON.stringify(action)}`)
  }
  const statAction = action as StatAction

  const values = raw.values
  if (!Array.isArray(values)) throw new Error('stat: values must be an array of numbers')
  if (values.length < 1) throw new Error('stat: values must contain at least 1 number')
  if (values.length > MAX_OBSERVATIONS) {
    throw new Error(`stat: values exceeds the ${MAX_OBSERVATIONS} observation limit`)
  }
  checkFiniteNumbers(values, 'values')

  const sample = raw.sample === true
  const method: CorrelationMethod = raw.method === 'spearman' ? 'spearman' : 'pearson'
  if (raw.method !== undefined && raw.method !== 'pearson' && raw.method !== 'spearman') {
    throw new Error('stat: method must be pearson or spearman')
  }

  if (statAction === 'describe' && sample && values.length < 2) {
    throw new Error('stat: sample variance requires at least 2 values')
  }

  let other: number[] | undefined
  if (statAction === 'correlation') {
    const rawOther = raw.other
    if (!Array.isArray(rawOther)) {
      throw new Error('stat: correlation requires the other array of paired observations')
    }
    if (rawOther.length !== values.length) {
      throw new Error(`stat: other must have the same length as values (got ${rawOther.length}, expected ${values.length})`)
    }
    if (rawOther.length < 2) {
      throw new Error('stat: correlation requires at least 2 paired observations')
    }
    checkFiniteNumbers(rawOther, 'other')
    other = normalizedCopy(rawOther)
  }
  // `other` 仅用于 correlation；其他 action 下忽略该参数。

  let percentiles: number[] = []
  if (statAction === 'percentile') {
    const rawPercentiles = raw.percentiles
    if (!Array.isArray(rawPercentiles) || rawPercentiles.length < 1) {
      throw new Error('stat: percentile requires the percentiles array (1..100 items)')
    }
    if (rawPercentiles.length > MAX_PERCENTILES) {
      throw new Error(`stat: percentiles exceeds the ${MAX_PERCENTILES} item limit`)
    }
    checkFiniteNumbers(rawPercentiles, 'percentiles')
    percentiles = normalizedCopy(rawPercentiles)
    for (const p of percentiles) {
      if (p < 0 || p > 100) {
        throw new Error(`stat: percentile must be within 0..100 (got ${p})`)
      }
    }
  }

  // `other` 仅存在于 correlation；exactOptionalPropertyTypes 下不能显式赋 undefined，
  // 用条件展开保持可选属性语义
  return {
    action: statAction,
    values: normalizedCopy(values),
    ...(other !== undefined ? { other } : {}),
    percentiles,
    method,
    sample,
  }
}
