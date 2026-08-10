import { describe, expect, it } from 'vitest'
import { frequencyValues } from '../src/frequency.ts'
import { MAX_DISTINCT } from '../src/validate.ts'

describe('frequencyValues', () => {
  it('groups by strict equality, ascending, with ratios over the original count (F-01)', () => {
    const r = frequencyValues([3, 1, 3, 2, 1, 3])
    expect(r.action).toBe('frequency')
    expect(r.count).toBe(6)
    expect(r.distinctTotal).toBe(3)
    expect(r.distinctReturned).toBe(3)
    expect(r.truncated).toBe(false)
    expect(r.returnedRatio).toBeCloseTo(1, 12)
    expect(r.entries.map(e => e.value)).toEqual([1, 2, 3])
    expect(r.entries[0]).toMatchObject({ value: 1, count: 2 })
    expect(r.entries[0]!.ratio).toBeCloseTo(2 / 6, 12)
    expect(r.entries[1]).toMatchObject({ value: 2, count: 1 })
    expect(r.entries[1]!.ratio).toBeCloseTo(1 / 6, 12)
    expect(r.entries[2]).toMatchObject({ value: 3, count: 3 })
    expect(r.entries[2]!.ratio).toBeCloseTo(3 / 6, 12)
  })

  it('merges -0 and 0 into a single 0 entry', () => {
    const r = frequencyValues([0, -0, 0])
    expect(r.distinctTotal).toBe(1)
    expect(r.entries).toEqual([{ value: 0, count: 3, ratio: 1 }])
    expect(Object.is(r.entries[0]!.value, -0)).toBe(false)
  })

  it('single distinct value', () => {
    const r = frequencyValues([5, 5, 5])
    expect(r.entries).toEqual([{ value: 5, count: 3, ratio: 1 }])
    expect(r.returnedRatio).toBe(1)
  })

  it('handles negative values and keeps ascending order', () => {
    const r = frequencyValues([0, -3, -3, 2, -1])
    expect(r.entries.map(e => e.value)).toEqual([-3, -1, 0, 2])
    expect(r.entries[0]!.count).toBe(2)
  })

  it('does not modify the input array', () => {
    const input = [3, 1, 3]
    frequencyValues(input)
    expect(input).toEqual([3, 1, 3])
  })

  it(`exactly ${MAX_DISTINCT} distinct values is not truncated`, () => {
    const values: number[] = []
    for (let v = 0; v < MAX_DISTINCT; v++) values.push(v)
    const r = frequencyValues(values)
    expect(r.truncated).toBe(false)
    expect(r.distinctTotal).toBe(MAX_DISTINCT)
    expect(r.distinctReturned).toBe(MAX_DISTINCT)
    expect(r.entries.length).toBe(MAX_DISTINCT)
    expect(r.entries[0]!.value).toBe(0)
    expect(r.entries[MAX_DISTINCT - 1]!.value).toBe(MAX_DISTINCT - 1)
  })

  it(`truncates beyond ${MAX_DISTINCT} distinct values: keeps top counts, then ascending (F-02)`, () => {
    // 10001 个 distinct：0..9998 各 1 次（9999 个），20000 出现 3 次，30000 出现 2 次
    const values: number[] = []
    for (let v = 0; v <= 9998; v++) values.push(v)
    values.push(20000, 20000, 20000)
    values.push(30000, 30000)
    expect(values.length).toBe(10004)

    const r = frequencyValues(values)
    expect(r.truncated).toBe(true)
    expect(r.distinctTotal).toBe(10001)
    expect(r.distinctReturned).toBe(MAX_DISTINCT)
    expect(r.entries.length).toBe(MAX_DISTINCT)
    // 截断选择：先按 count 降序（20000×3、30000×2），再按 value 升序取单次值
    // 单次值 0..9998 中保留前 9998 个（0..9997），9998 被丢弃
    expect(r.entries[0]!.value).toBe(0)
    expect(r.entries[9997]!.value).toBe(9997)
    expect(r.entries[9998]!.value).toBe(20000)
    expect(r.entries[9999]!.value).toBe(30000)
    expect(r.entries.some(e => e.value === 9998)).toBe(false)
    // ratio 分母是原始计数；已返回项 ratio 总和 < 1
    expect(r.entries[9998]!.ratio).toBeCloseTo(3 / 10004, 12)
    expect(r.entries[9999]!.ratio).toBeCloseTo(2 / 10004, 12)
    expect(r.returnedRatio).toBeCloseTo((9998 + 3 + 2) / 10004, 12)
  })
})
