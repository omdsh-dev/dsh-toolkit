import { describe, expect, it } from 'vitest'
import { percentileValues } from '../src/describe.ts'

describe('percentileValues', () => {
  it('computes grid percentiles for [1,2,3,4,5]', () => {
    const r = percentileValues([1, 2, 3, 4, 5], [0, 25, 50, 75, 100])
    expect(r.action).toBe('percentile')
    expect(r.count).toBe(5)
    expect(r.percentiles).toEqual([
      { percentile: 0, value: 1 },
      { percentile: 25, value: 2 },
      { percentile: 50, value: 3 },
      { percentile: 75, value: 4 },
      { percentile: 100, value: 5 },
    ])
  })

  it('interpolates for even-length arrays', () => {
    const r = percentileValues([1, 2, 3, 4], [25, 50, 75])
    expect(r.percentiles[0]!.value).toBeCloseTo(1.75, 12)
    expect(r.percentiles[1]!.value).toBe(2.5)
    expect(r.percentiles[2]!.value).toBeCloseTo(3.25, 12)
  })

  it('keeps the caller-requested order (P-01)', () => {
    const r = percentileValues([1, 2, 3, 4, 5], [75, 25, 50])
    expect(r.percentiles.map(e => e.percentile)).toEqual([75, 25, 50])
  })

  it('does not deduplicate repeated percentiles', () => {
    const r = percentileValues([1, 2, 3, 4, 5], [50, 50, 50])
    expect(r.percentiles).toEqual([
      { percentile: 50, value: 3 },
      { percentile: 50, value: 3 },
      { percentile: 50, value: 3 },
    ])
  })

  it('handles a single-element array', () => {
    const r = percentileValues([7], [0, 50, 100])
    expect(r.percentiles).toEqual([
      { percentile: 0, value: 7 },
      { percentile: 50, value: 7 },
      { percentile: 100, value: 7 },
    ])
  })

  it('normalizes a -0 percentile request to 0', () => {
    const r = percentileValues([1, 2, 3], [-0])
    expect(r.percentiles[0]!.percentile).toBe(0)
    expect(Object.is(r.percentiles[0]!.percentile, -0)).toBe(false)
    expect(r.percentiles[0]!.value).toBe(1)
  })

  it('does not modify the input array', () => {
    const values = [5, 3, 1, 4, 2]
    const percentiles = [50, 25]
    percentileValues(values, percentiles)
    expect(values).toEqual([5, 3, 1, 4, 2])
    expect(percentiles).toEqual([50, 25])
  })
})
