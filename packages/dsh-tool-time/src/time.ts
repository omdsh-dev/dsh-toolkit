/**
 * dsh-tool-time 核心实现 —— 严格 ISO 解析 + UTC 日历运算 + Intl 时区格式化。
 *
 * 契约（v2，已冻结）：
 * - 输入：严格 ISO 8601 子集（YYYY-MM-DD | YYYY-MM-DDTHH:mm:ssZ | ±HH:MM 偏移，
 *   可选 .SSS 毫秒）；不带时区的日期时间拒绝；日历溢出拒绝
 * - add：始终 UTC 运算；月/年先置 1 日→定位目标年月→按目标月最大天数钳制
 * - diff：仅固定时长（sign + 带符号总量 + absolute 余数分解），无月份/年份
 * - 时区：默认 UTC；timezoneSource: "explicit" | "default-utc"
 * - 错误统一 "time: " 前缀
 */

// ── 常量 ──

const MAX_STRING_LENGTH = 200
/** Date 支持 ±275760 年 ≈ 3,309,120 个月；months 前置业务上限（RECHECK-TIME-02）。 */
const MAX_MONTH_AMOUNT = 3_000_000
const UNITS = ['seconds', 'minutes', 'hours', 'days', 'weeks', 'months', 'years'] as const
type Unit = typeof UNITS[number]

/** 严格 ISO 子集（不含时区的日期时间在此被拒绝） */
const ISO_RE =
  /^([1-9]\d{3})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2}))?$/

interface TimeResult {
  iso: string
  unix: number
  timezone: string
  timezoneSource: 'explicit' | 'default-utc'
  local: string
  formatted: string
}

interface DiffResult {
  sign: -1 | 0 | 1
  milliseconds: number
  seconds: number
  minutes: number
  hours: number
  days: number
  weeks: number
  absolute: { days: number; hours: number; minutes: number; seconds: number; milliseconds: number }
}

// ── 严格 ISO 解析 ──

/** 校验并解析严格 ISO 字符串。失败抛 `time: ...` 错误。 */
function parseStrictISO(value: string): Date {
  const m = ISO_RE.exec(value)
  if (!m) throw new Error('time: invalid ISO timestamp')
  const [, y, mo, d, h, mi, s, , tz] = m
  const year = Number(y)
  const month = Number(mo)
  const day = Number(d)

  // 日历校验（Date 会把 2026-02-30 归一化，必须自己拦）：
  // 月份 1-12 + 按目标年月查表的天数上限（闰年 2 月 29 自动正确）
  if (month < 1 || month > 12) throw new Error('time: invalid calendar date')
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day < 1 || day > daysInMonth) throw new Error('time: invalid calendar date')

  if (tz === undefined) {
    // 纯日期：按 UTC 零点解释
    const date = new Date(Date.UTC(year, month - 1, day))
    if (Number.isNaN(date.getTime())) throw new Error('time: invalid calendar date')
    return date
  }

  // 完整日期时间：时/分/秒范围校验（防 Date 静默归一化 25:00 等）
  const hour = Number(h)
  const minute = Number(mi)
  const second = Number(s ?? '0')
  if (hour > 23 || minute > 59 || second > 59) throw new Error('time: invalid ISO timestamp')
  if (tz !== 'Z') {
    // 数字偏移：±14:00 内、分钟 ≤59（ISO 8601 规范范围）
    const om = /^([+-])(\d{2}):(\d{2})$/.exec(tz)
    if (!om) throw new Error('time: invalid ISO timestamp')
    const oh = Number(om[2])
    const omin = Number(om[3])
    if (oh > 14 || (oh === 14 && omin > 0) || omin > 59) throw new Error('time: invalid ISO timestamp')
  }

  const date = new Date(value) // 正则保证 ISO 形态；Date 原生解析偏移
  if (Number.isNaN(date.getTime()) || !Number.isFinite(date.getTime())) {
    throw new Error('time: invalid ISO timestamp')
  }
  return date
}

// ── Intl 时区格式化（环境固定：en-CA + hourCycle h23） ──

/** 目标时区的墙钟各字段（parts 字典）。非法时区抛 `time: unknown timezone`。 */
function wallClockParts(date: Date, timezone: string): Record<string, string> {
  let dtf: Intl.DateTimeFormat
  try {
    dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
  } catch {
    throw new Error(`time: unknown timezone "${timezone}"`)
  }
  const parts: Record<string, string> = {}
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  return parts
}

/** 目标时区相对 UTC 的偏移毫秒（东八区 = +28800000）。 */
function offsetMs(date: Date, timezone: string): number {
  const p = wallClockParts(date, timezone)
  const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return asUTC + date.getUTCMilliseconds() - date.getTime()
}

function formatOffset(ms: number): string {
  const sign = ms < 0 ? '-' : '+'
  const abs = Math.abs(ms)
  const h = String(Math.floor(abs / 3_600_000)).padStart(2, '0')
  const m = String(Math.floor((abs % 3_600_000) / 60_000)).padStart(2, '0')
  return `${sign}${h}:${m}`
}

function formatInTimezone(date: Date, timezone: string): { local: string; formatted: string } {
  const p = wallClockParts(date, timezone)
  // AUDIT-TIME-01：目标时区的当地年份也必须留在 1000–9999
  // （UTC instant 在范围内但当地可跨年前/后一年；且 p.year 传给 Date.UTC 会触发 0-99 年映射）
  const localYear = Number(p.year)
  if (localYear < 1000 || localYear > 9999) {
    throw new Error('time: result outside supported year range 1000-9999')
  }
  const local = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${formatOffset(offsetMs(date, timezone))}`
  const formatted = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} (${timezone})`
  return { local, formatted }
}

/** RECHECK4-TIME-01/02：结果年份必须留在工具契约 1000–9999（覆盖 now/convert/add 全部输出路径）。 */
function assertSupportedResultYear(date: Date): void {
  const year = date.getUTCFullYear()
  if (year < 1000 || year > 9999) {
    throw new Error('time: result outside supported year range 1000-9999')
  }
}

function buildResult(date: Date, timezone: string, source: 'explicit' | 'default-utc'): TimeResult {
  assertSupportedResultYear(date)
  const { local, formatted } = formatInTimezone(date, timezone)
  return {
    iso: date.toISOString(),
    unix: date.getTime(),
    timezone,
    timezoneSource: source,
    local,
    formatted,
  }
}

// ── 日历运算（UTC 基准） ──

/** 月/年运算：先置 1 日 → 定位目标年月 → 按目标月最大天数钳制。 */
function addMonthsClamped(date: Date, months: number): Date {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + months
  const target = new Date(Date.UTC(y, m, 1)) // Date 自动滚年
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay))
  return target
}

function addCalendar(date: Date, amount: number, unit: Unit): Date {
  const result = new Date(date)
  switch (unit) {
    case 'seconds': result.setUTCSeconds(result.getUTCSeconds() + amount); break
    case 'minutes': result.setUTCMinutes(result.getUTCMinutes() + amount); break
    case 'hours': result.setUTCHours(result.getUTCHours() + amount); break
    case 'days': result.setUTCDate(result.getUTCDate() + amount); break
    case 'weeks': {
      const total = amount * 7
      if (!Number.isSafeInteger(total)) throw new Error('time: amount out of range for unit "weeks"')
      result.setUTCDate(result.getUTCDate() + total)
      break
    }
    case 'months': {
      // RECHECK-TIME-02：与 weeks/years 一致，前置拒绝超出 Date 支持范围的月份数
      if (Math.abs(amount) > MAX_MONTH_AMOUNT) {
        throw new Error('time: amount out of range for unit "months"')
      }
      const r = addMonthsClamped(result, amount)
      if (!Number.isFinite(r.getTime())) throw new Error('time: result outside supported range')
      result.setTime(r.getTime())
      break
    }
    case 'years': {
      const total = amount * 12
      if (!Number.isSafeInteger(total)) throw new Error('time: amount out of range for unit "years"')
      const r = addMonthsClamped(result, total)
      if (!Number.isFinite(r.getTime())) throw new Error('time: result outside supported range')
      result.setTime(r.getTime())
      break
    }
  }
  if (!Number.isFinite(result.getTime())) throw new Error('time: result outside supported range')
  // RECHECK3-TIME-01：结果年份必须留在工具的 1000–9999 契约内
  // （否则 BCE/扩展年份会让 Intl era 年与 offset 计算产生错误输出）
  assertSupportedResultYear(result)
  return result
}

// ── diff（固定时长，无月份/年份） ──

function diffBetween(from: Date, to: Date): DiffResult {
  const ms = to.getTime() - from.getTime()
  // AUDIT-TIME-02：duration 精度保护——差值必须有限且在安全整数内
  if (!Number.isFinite(ms) || Math.abs(ms) > Number.MAX_SAFE_INTEGER) {
    throw new Error('time: diff duration out of range')
  }
  const sign: -1 | 0 | 1 = ms > 0 ? 1 : ms < 0 ? -1 : 0
  const abs = Math.abs(ms)
  const totalSeconds = Math.floor(abs / 1000)
  const absolute = {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3_600),
    minutes: Math.floor((totalSeconds % 3_600) / 60),
    seconds: totalSeconds % 60,
    milliseconds: abs % 1000,
  }
  return {
    sign: sign,
    milliseconds: ms,
    seconds: sign * totalSeconds,
    minutes: sign * Math.floor(abs / 60_000),
    hours: sign * Math.floor(abs / 3_600_000),
    days: sign * Math.floor(abs / 86_400_000),
    weeks: sign * Math.floor(abs / 604_800_000),
    absolute,
  }
}

// ── 入口：action 分发 + 独立运行时校验 ──

export interface ActionParams {
  value?: string
  timezone?: string
  from?: string
  to?: string
  amount?: number
  unit?: string
}

/** 默认时钟（测试可注入 fake clock） */
type Clock = () => number

function assertStringLength(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`time: missing required parameter "${name}"`)
  if (value.length > MAX_STRING_LENGTH) throw new Error(`time: parameter "${name}" too long`)
}

export function executeAction(
  action: string,
  params: ActionParams,
  clock: Clock = () => Date.now(),
): unknown {
  switch (action) {
    case 'now': {
      const timezone = params.timezone
      if (timezone !== undefined) {
        assertStringLength(timezone, 'timezone')
        if (timezone === '') throw new Error('time: timezone must not be empty')
      }
      const timestamp = clock()
      if (!Number.isFinite(timestamp)) throw new Error('time: clock returned invalid timestamp')
      const date = new Date(timestamp)
      if (!Number.isFinite(date.getTime())) throw new Error('time: clock returned out-of-range timestamp')
      const explicit = timezone !== undefined
      return buildResult(date, explicit ? timezone : 'UTC', explicit ? 'explicit' : 'default-utc')
    }
    case 'convert': {
      assertStringLength(params.value, 'value')
      assertStringLength(params.timezone, 'timezone')
      if (params.timezone === '') throw new Error('time: timezone must not be empty')
      const date = parseStrictISO(params.value)
      return buildResult(date, params.timezone, 'explicit')
    }
    case 'add': {
      assertStringLength(params.value, 'value')
      const unit = params.unit
      if (typeof unit !== 'string' || !(UNITS as readonly string[]).includes(unit)) {
        throw new Error(`time: unknown unit "${String(unit)}"`)
      }
      if (typeof params.amount !== 'number' || !Number.isSafeInteger(params.amount)) {
        throw new Error('time: amount must be a safe integer')
      }
      const date = parseStrictISO(params.value)
      if (params.timezone !== undefined) {
        assertStringLength(params.timezone, 'timezone')
        if (params.timezone === '') throw new Error('time: timezone must not be empty')
      }
      const timezone = params.timezone ?? 'UTC'
      const result = addCalendar(date, params.amount, unit as Unit)
      const source = params.timezone !== undefined ? 'explicit' : 'default-utc'
      return buildResult(result, timezone, source)
    }
    case 'diff': {
      assertStringLength(params.from, 'from')
      assertStringLength(params.to, 'to')
      // RECHECK5-TIME-01：diff 输入同样受结果年份契约约束（offset 换算后的 instant）
      // ——与 convert 对相同输入的行为保持一致，避免跨 action 不一致
      const fromDate = parseStrictISO(params.from)
      const toDate = parseStrictISO(params.to)
      assertSupportedResultYear(fromDate)
      assertSupportedResultYear(toDate)
      return diffBetween(fromDate, toDate)
    }
    default:
      throw new Error(`time: unknown action "${action}"`)
  }
}
