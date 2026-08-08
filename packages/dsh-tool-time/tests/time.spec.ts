import { describe, expect, it } from 'vitest'
import { executeAction } from '../src/time.ts'

const FAKE_NOW = Date.parse('2026-08-05T06:00:00.000Z')
const clock = (): number => FAKE_NOW

function act(action: string, params: Record<string, unknown> = {}): any {
  return executeAction(action, params, clock)
}

describe('time: now', () => {
  it('returns current time with default UTC timezone (fake clock)', () => {
    const r = act('now')
    expect(r.iso).toBe('2026-08-05T06:00:00.000Z')
    expect(r.unix).toBe(FAKE_NOW)
    expect(r.timezone).toBe('UTC')
    expect(r.timezoneSource).toBe('default-utc')
    expect(r.local).toBe('2026-08-05T06:00:00+00:00')
    expect(r.formatted).toBe('2026-08-05 06:00:00 (UTC)')
  })

  it('honors explicit timezone with source marker', () => {
    const r = act('now', { timezone: 'Asia/Shanghai' })
    expect(r.timezone).toBe('Asia/Shanghai')
    expect(r.timezoneSource).toBe('explicit')
    expect(r.local).toBe('2026-08-05T14:00:00+08:00')
  })

  it('real-clock integration: unix within 5s of Date.now()', () => {
    const r = executeAction('now', {}) as { unix: number }
    expect(Math.abs(r.unix - Date.now())).toBeLessThan(5000)
  })

  it('rejects unknown timezone', () => {
    expect(() => act('now', { timezone: 'Not/AZone' })).toThrow('time: unknown timezone "Not/AZone"')
  })
})

describe('time: convert', () => {
  it('converts UTC to Asia/Shanghai', () => {
    const r = act('convert', { value: '2026-01-01T00:00:00Z', timezone: 'Asia/Shanghai' })
    expect(r.iso).toBe('2026-01-01T00:00:00.000Z')
    expect(r.local).toBe('2026-01-01T08:00:00+08:00')
    expect(r.timezoneSource).toBe('explicit')
  })

  it('converts to New York in EDT (DST active)', () => {
    const r = act('convert', { value: '2026-07-01T12:00:00Z', timezone: 'America/New_York' })
    expect(r.local).toBe('2026-07-01T08:00:00-04:00')
  })

  it('converts to New York in EST (DST inactive)', () => {
    const r = act('convert', { value: '2026-01-01T12:00:00Z', timezone: 'America/New_York' })
    expect(r.local).toBe('2026-01-01T07:00:00-05:00')
  })

  it('accepts numeric offset input (same instant)', () => {
    const a = act('convert', { value: '2026-01-01T09:00:00+09:00', timezone: 'UTC' })
    const b = act('convert', { value: '2026-01-01T00:00:00Z', timezone: 'UTC' })
    expect(a.iso).toBe(b.iso)
    expect(a.unix).toBe(b.unix)
  })

  it('accepts millisecond fractions', () => {
    const r = act('convert', { value: '2026-01-01T00:00:00.123Z', timezone: 'UTC' })
    expect(r.iso).toBe('2026-01-01T00:00:00.123Z')
  })

  it('treats bare date as UTC midnight', () => {
    const r = act('convert', { value: '2026-01-01', timezone: 'UTC' })
    expect(r.iso).toBe('2026-01-01T00:00:00.000Z')
  })

  it('missing value is rejected', () => {
    expect(() => act('convert', { timezone: 'UTC' })).toThrow('time: missing required parameter "value"')
  })
})

describe('time: add', () => {
  it('adds days', () => {
    const r = act('add', { value: '2026-01-01', amount: 3, unit: 'days' })
    expect(r.iso).toBe('2026-01-04T00:00:00.000Z')
  })

  it('subtracts hours', () => {
    const r = act('add', { value: '2026-01-01T00:00:00Z', amount: -6, unit: 'hours' })
    expect(r.iso).toBe('2025-12-31T18:00:00.000Z')
  })

  it('adds weeks', () => {
    const r = act('add', { value: '2026-01-01', amount: 2, unit: 'weeks' })
    expect(r.iso).toBe('2026-01-15T00:00:00.000Z')
  })

  it('clamps month-end: Jan 31 + 1 month = Feb 28', () => {
    const r = act('add', { value: '2026-01-31', amount: 1, unit: 'months' })
    expect(r.iso).toBe('2026-02-28T00:00:00.000Z')
  })

  it('clamps month-end: Jan 31 - 1 month = Dec 31', () => {
    const r = act('add', { value: '2026-01-31', amount: -1, unit: 'months' })
    expect(r.iso).toBe('2025-12-31T00:00:00.000Z')
  })

  it('clamps month-end: Jan 31 + 2 months = Mar 31 (no clamp needed)', () => {
    const r = act('add', { value: '2026-01-31', amount: 2, unit: 'months' })
    expect(r.iso).toBe('2026-03-31T00:00:00.000Z')
  })

  it('clamps leap day: Feb 29 2028 + 1 year = Feb 28 2029', () => {
    const r = act('add', { value: '2028-02-29', amount: 1, unit: 'years' })
    expect(r.iso).toBe('2029-02-28T00:00:00.000Z')
  })

  it('rolls year across boundary', () => {
    const r = act('add', { value: '2026-12-31', amount: 1, unit: 'months' })
    expect(r.iso).toBe('2027-01-31T00:00:00.000Z')
  })

  it('handles large amounts (±100 years)', () => {
    const r = act('add', { value: '2026-01-01', amount: 100, unit: 'years' })
    expect(r.iso).toBe('2126-01-01T00:00:00.000Z')
    const neg = act('add', { value: '2026-01-01', amount: -100, unit: 'years' })
    expect(neg.iso).toBe('1926-01-01T00:00:00.000Z')
  })

  it('timezone affects display only, arithmetic stays UTC', () => {
    const r = act('add', { value: '2026-01-01T00:00:00Z', amount: 1, unit: 'days', timezone: 'Asia/Shanghai' })
    expect(r.iso).toBe('2026-01-02T00:00:00.000Z') // UTC 运算
    expect(r.local).toBe('2026-01-02T08:00:00+08:00') // 展示时区
    expect(r.timezoneSource).toBe('explicit')
  })

  it('rejects non-safe-integer amount', () => {
    expect(() => act('add', { value: '2026-01-01', amount: 1.5, unit: 'days' })).toThrow('amount must be a safe integer')
    expect(() => act('add', { value: '2026-01-01', amount: 1e309, unit: 'days' })).toThrow('amount must be a safe integer')
    expect(() => act('add', { value: '2026-01-01', amount: NaN, unit: 'days' })).toThrow('amount must be a safe integer')
  })

  it('rejects unknown unit', () => {
    expect(() => act('add', { value: '2026-01-01', amount: 1, unit: 'fortnights' })).toThrow('time: unknown unit "fortnights"')
  })

  it('rejects out-of-range result', () => {
    expect(() => act('add', { value: '2026-01-01', amount: 999_999_999, unit: 'years' })).toThrow('time: result outside supported range')
  })
})

describe('time: diff', () => {
  it('same instant: sign 0', () => {
    const r = act('diff', { from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' })
    expect(r.sign).toBe(0)
    expect(r.milliseconds).toBe(0)
  })

  it('positive diff with absolute decomposition (3d6h = 78h)', () => {
    const r = act('diff', { from: '2026-01-01T00:00:00Z', to: '2026-01-04T06:00:00Z' })
    expect(r.sign).toBe(1)
    expect(r.milliseconds).toBe(280_800_000)
    expect(r.seconds).toBe(280_800)
    expect(r.minutes).toBe(4_680)
    expect(r.hours).toBe(78)
    expect(r.days).toBe(3)
    expect(r.weeks).toBe(0)
    expect(r.absolute).toEqual({ days: 3, hours: 6, minutes: 0, seconds: 0, milliseconds: 0 })
  })

  it('negative diff mirrors sign', () => {
    const r = act('diff', { from: '2026-01-04T06:00:00Z', to: '2026-01-01T00:00:00Z' })
    expect(r.sign).toBe(-1)
    expect(r.days).toBe(-3)
    expect(r.absolute).toEqual({ days: 3, hours: 6, minutes: 0, seconds: 0, milliseconds: 0 })
  })

  it('crosses year boundary', () => {
    const r = act('diff', { from: '2025-12-30T00:00:00Z', to: '2026-01-02T00:00:00Z' })
    expect(r.days).toBe(3)
    expect(r.absolute.days).toBe(3)
  })
})

describe('time: strict ISO input', () => {
  it('rejects calendar overflow 2026-02-30', () => {
    expect(() => act('convert', { value: '2026-02-30', timezone: 'UTC' })).toThrow('time: invalid calendar date')
    expect(() => act('convert', { value: '2026-02-30T00:00:00Z', timezone: 'UTC' })).toThrow('time: invalid calendar date')
  })

  it('rejects invalid month/day', () => {
    expect(() => act('convert', { value: '2026-13-01', timezone: 'UTC' })).toThrow('time: invalid calendar date')
    expect(() => act('convert', { value: '2026-00-10', timezone: 'UTC' })).toThrow('time: invalid calendar date')
    expect(() => act('convert', { value: '2026-01-32', timezone: 'UTC' })).toThrow('time: invalid calendar date')
  })

  it('rejects timezone-less datetime', () => {
    expect(() => act('convert', { value: '2026-01-01T12:00:00', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
  })

  it('rejects non-ISO strings (RFC 2822, garbage, natural language)', () => {
    expect(() => act('convert', { value: 'Wed, 05 Aug 2026 10:00:00 GMT', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
    expect(() => act('convert', { value: 'garbage', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
    expect(() => act('convert', { value: 'next week', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
  })

  it('rejects out-of-range clock fields (25:00, minute 60)', () => {
    expect(() => act('convert', { value: '2026-01-01T25:00:00Z', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
    expect(() => act('convert', { value: '2026-01-01T00:60:00Z', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
  })

  it('rejects invalid offsets (+99:00, +00:60)', () => {
    expect(() => act('convert', { value: '2026-01-01T00:00:00+99:00', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
    expect(() => act('convert', { value: '2026-01-01T00:00:00+00:60', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
    expect(() => act('convert', { value: '2026-01-01T00:00:00+14:01', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
  })

  it('accepts +14:00 max offset boundary', () => {
    const r = act('convert', { value: '2026-01-01T00:00:00+14:00', timezone: 'UTC' })
    expect(r.iso).toBe('2025-12-31T10:00:00.000Z')
  })
})

describe('time: attacks and limits', () => {
  it('rejects prototype-named timezones', () => {
    expect(() => act('now', { timezone: '__proto__' })).toThrow('time: unknown timezone')
    expect(() => act('now', { timezone: 'constructor' })).toThrow('time: unknown timezone')
  })

  it('rejects code-injection-shaped values (no eval path)', () => {
    expect(() => act('convert', { value: 'constructor.constructor("return 1")()', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
  })

  it('rejects unsafe numeric attack payloads', () => {
    expect(() => act('add', { value: '2026-01-01', amount: 1e999, unit: 'days' })).toThrow('amount must be a safe integer')
    expect(() => act('add', { value: '2026-01-01', amount: Number.MAX_SAFE_INTEGER + 2, unit: 'days' })).toThrow('amount must be a safe integer')
  })

  it('rejects eval-like unit', () => {
    expect(() => act('add', { value: '2026-01-01', amount: 1, unit: 'eval' })).toThrow('time: unknown unit')
  })

  it('rejects over-long strings', () => {
    expect(() => act('convert', { value: 'x'.repeat(201), timezone: 'UTC' })).toThrow('time: parameter "value" too long')
    expect(() => act('now', { timezone: 'A'.repeat(201) })).toThrow('time: parameter "timezone" too long')
  })

  it('rejects unknown action', () => {
    expect(() => act('eval')).toThrow('time: unknown action "eval"')
  })
})

// ── 审查回归（2026-08-06，dsh-tool-encoding-time-review-report）──

describe('review regressions', () => {
  it('TIME-01: rejects years below 1000 (Date.UTC 0-99 mapping)', () => {
    expect(() => act('convert', { value: '0001-01-01', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
    expect(() => act('convert', { value: '0099-12-31', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
    expect(() => act('convert', { value: '0000-02-29', timezone: 'UTC' })).toThrow('time: invalid ISO timestamp')
    expect(() => act('add', { value: '0001-01-01', amount: 1, unit: 'years' })).toThrow('time: invalid ISO timestamp')
  })

  it('TIME-01: accepts year 1000 boundary', () => {
    const r = act('convert', { value: '1000-01-01', timezone: 'UTC' })
    expect(r.iso).toBe('1000-01-01T00:00:00.000Z')
    expect(r.local).toBe('1000-01-01T00:00:00+00:00')
  })

  it('TIME-02: offset keeps milliseconds for non-UTC timezone', () => {
    const r = act('convert', { value: '2026-01-01T00:00:00.123Z', timezone: 'Asia/Shanghai' })
    expect(r.local).toBe('2026-01-01T08:00:00+08:00') // 修复前会算成 +07:59
  })

  it('TIME-04: invalid clock is rejected with time: prefix', () => {
    expect(() => executeAction('now', {}, () => NaN)).toThrow('time: clock returned invalid timestamp')
    expect(() => executeAction('now', {}, () => Infinity)).toThrow('time: clock returned invalid timestamp')
    expect(() => executeAction('now', {}, () => Number.MAX_VALUE * 2)).toThrow('time: clock returned')
  })

  it('TIME-05: empty timezone is rejected consistently across actions', () => {
    expect(() => act('now', { timezone: '' })).toThrow('time: timezone must not be empty')
    expect(() => act('convert', { value: '2026-01-01', timezone: '' })).toThrow('time: timezone must not be empty')
    expect(() => act('add', { value: '2026-01-01', amount: 1, unit: 'days', timezone: '' })).toThrow('time: timezone must not be empty')
  })

  it('TIME-06: extreme amounts for weeks/years are rejected before multiplication', () => {
    expect(() => act('add', { value: '2026-01-01', amount: Number.MAX_SAFE_INTEGER, unit: 'weeks' })).toThrow('time: amount out of range for unit "weeks"')
    expect(() => act('add', { value: '2026-01-01', amount: Number.MAX_SAFE_INTEGER, unit: 'years' })).toThrow('time: amount out of range for unit "years"')
  })
})

describe('recheck regressions', () => {
  it('RECHECK-TIME-02: extreme months amount rejected up front', () => {
    expect(() => act('add', { value: '2026-01-01', amount: Number.MAX_SAFE_INTEGER, unit: 'months' })).toThrow('time: amount out of range for unit "months"')
  })

  it('RECHECK-TIME-02: months over Date-supported range rejected up front', () => {
    expect(() => act('add', { value: '2026-01-01', amount: 1e12, unit: 'months' })).toThrow('time: amount out of range for unit "months"')
    expect(() => act('add', { value: '2026-01-01', amount: 3_500_000, unit: 'months' })).toThrow('time: amount out of range for unit "months"')
  })

  it('RECHECK-TIME-02: extreme amounts for other units stay consistent', () => {
    expect(() => act('add', { value: '2026-01-01', amount: Number.MAX_SAFE_INTEGER, unit: 'days' })).toThrow('time: result outside supported range')
    expect(() => act('add', { value: '2026-01-01', amount: Number.MAX_SAFE_INTEGER, unit: 'hours' })).toThrow('time: result outside supported range')
    expect(() => act('add', { value: '2026-01-01', amount: Number.MAX_SAFE_INTEGER, unit: 'seconds' })).toThrow('time: result outside supported range')
  })
})

describe('recheck3 regressions', () => {
  it('RECHECK3-TIME-01: negative extreme months rejected (year below 1000)', () => {
    expect(() => act('add', { value: '1000-01-01', amount: -3_000_000, unit: 'months' })).toThrow('time: result outside supported year range 1000-9999')
  })

  it('RECHECK3-TIME-01: positive extreme months rejected (year above 9999)', () => {
    expect(() => act('add', { value: '9999-12-31', amount: 3_000_000, unit: 'months' })).toThrow('time: result outside supported year range 1000-9999')
  })

  it('RECHECK3-TIME-01: boundary years are rejected when result leaves range', () => {
    expect(() => act('add', { value: '1000-01-01', amount: -1, unit: 'days' })).toThrow('time: result outside supported year range')
    expect(() => act('add', { value: '9999-12-31', amount: 1, unit: 'days' })).toThrow('time: result outside supported year range')
  })

  it('RECHECK3-TIME-01: in-range results still work', () => {
    expect(act('add', { value: '1000-01-01', amount: 1, unit: 'days' }).iso).toBe('1000-01-02T00:00:00.000Z')
    expect(act('add', { value: '9999-12-30', amount: 1, unit: 'days' }).iso).toBe('9999-12-31T00:00:00.000Z')
  })
})

describe('recheck4 regressions', () => {
  it('RECHECK4-TIME-01: convert offset pushing instant below year 1000 rejected', () => {
    expect(() => act('convert', { value: '1000-01-01T00:00:00+14:00', timezone: 'UTC' })).toThrow('time: result outside supported year range')
  })

  it('RECHECK4-TIME-01: convert offset pushing instant above year 9999 rejected', () => {
    expect(() => act('convert', { value: '9999-12-31T23:59:59-14:00', timezone: 'UTC' })).toThrow('time: result outside supported year range')
  })

  it('RECHECK4-TIME-01: in-range boundary converts still work', () => {
    expect(act('convert', { value: '1000-01-01T00:00:00Z', timezone: 'UTC' }).iso).toBe('1000-01-01T00:00:00.000Z')
    expect(act('convert', { value: '9999-12-31T23:59:59Z', timezone: 'UTC' }).iso).toBe('9999-12-31T23:59:59.000Z')
    // +14:00 偏移但 instant 仍在范围内的用例（2026 年）
    expect(act('convert', { value: '2026-01-01T00:00:00+14:00', timezone: 'UTC' }).iso).toBe('2025-12-31T10:00:00.000Z')
  })

  it('RECHECK4-TIME-02: now with extreme clock rejected', () => {
    expect(() => executeAction('now', {}, () => Date.UTC(10000, 0, 1))).toThrow('time: result outside supported year range')
    expect(() => executeAction('now', {}, () => Date.UTC(999, 0, 1))).toThrow('time: result outside supported year range')
  })
})

describe('recheck5 regressions', () => {
  it('RECHECK5-TIME-01: diff rejects instants outside supported year range', () => {
    expect(() => act('diff', { from: '1000-01-01T00:00:00+14:00', to: '1000-01-02T00:00:00Z' })).toThrow('time: result outside supported year range')
    expect(() => act('diff', { from: '9999-12-31T23:59:59-14:00', to: '9999-12-31T23:59:59Z' })).toThrow('time: result outside supported year range')
  })

  it('RECHECK5-TIME-01: diff in-range instants still work', () => {
    const r = act('diff', { from: '1000-01-01T00:00:00Z', to: '1000-01-02T00:00:00Z' })
    expect(r.days).toBe(1)
  })
})

describe('audit regressions', () => {
  it('AUDIT-TIME-01: local year below 1000 rejected (UTC instant in range)', () => {
    expect(() => act('convert', { value: '1000-01-01T00:00:00Z', timezone: 'America/Los_Angeles' })).toThrow('time: result outside supported year range')
  })

  it('AUDIT-TIME-01: local year above 9999 rejected (UTC instant in range)', () => {
    expect(() => act('convert', { value: '9999-12-31T23:59:59Z', timezone: 'Asia/Tokyo' })).toThrow('time: result outside supported year range')
  })

  it('AUDIT-TIME-01: local year in range still works', () => {
    const r = act('convert', { value: '1000-01-01T12:00:00Z', timezone: 'Asia/Tokyo' })
    expect(r.local.startsWith('1000-01-01')).toBe(true)
    const r2 = act('convert', { value: '9999-12-31T03:00:00Z', timezone: 'America/Los_Angeles' })
    expect(r2.local.startsWith('9999-12-30')).toBe(true)
  })
})
