import { describe, expect, it } from 'vitest'
import {
  compensatedSum, welford, percentileAt, sortedCopy, describeValues,
} from '../src/describe.ts'

describe('compensatedSum (Neumaier)', () => {
  it('sums plain arrays', () => {
    expect(compensatedSum([1, 2, 3, 4, 5])).toBe(15)
    expect(compensatedSum([])).toBe(0)
  })

  it('recovers the small term lost by naive summation (D-01)', () => {
    // naive: (1e16 + 1) + (-1e16) === 0；compensated 应得 1
    expect(compensatedSum([1e16, 1, -1e16])).toBe(1)
  })

  it('handles floats deterministically', () => {
    expect(compensatedSum([0.1, 0.2, 0.3])).toBeCloseTo(0.6, 15)
    expect(compensatedSum([-1.5, 2.25, -0.75])).toBeCloseTo(0, 15)
  })

  it('handles negatives and mixed signs', () => {
    expect(compensatedSum([-5, -3, -2])).toBe(-10)
    expect(compensatedSum([2, -2, 2, -2])).toBe(0)
  })
})

describe('welford (online mean/M2)', () => {
  it('computes mean and M2 for 1..5', () => {
    const { mean, m2 } = welford([1, 2, 3, 4, 5])
    expect(mean).toBeCloseTo(3, 12)
    expect(m2).toBeCloseTo(10, 12)
  })

  it('constant series has zero M2', () => {
    const { mean, m2 } = welford([2, 2, 2])
    expect(mean).toBe(2)
    expect(m2).toBe(0)
  })

  it('single element', () => {
    const { mean, m2 } = welford([7])
    expect(mean).toBe(7)
    expect(m2).toBe(0)
  })
})

describe('percentileAt (linear interpolation h=(n-1)*p)', () => {
  const sorted = [1, 2, 3, 4, 5]
  it('returns exact order statistics at grid points', () => {
    expect(percentileAt(sorted, 0)).toBe(1)
    expect(percentileAt(sorted, 0.25)).toBe(2)
    expect(percentileAt(sorted, 0.5)).toBe(3)
    expect(percentileAt(sorted, 0.75)).toBe(4)
    expect(percentileAt(sorted, 1)).toBe(5)
  })

  it('interpolates between adjacent order statistics', () => {
    const even = [1, 2, 3, 4]
    expect(percentileAt(even, 0.25)).toBeCloseTo(1.75, 12) // h=0.75
    expect(percentileAt(even, 0.5)).toBe(2.5)              // h=1.5
    expect(percentileAt(even, 0.75)).toBeCloseTo(3.25, 12) // h=2.25
  })

  it('single-element arrays return that element', () => {
    expect(percentileAt([7], 0)).toBe(7)
    expect(percentileAt([7], 0.5)).toBe(7)
    expect(percentileAt([7], 1)).toBe(7)
  })

  it('rejects out-of-range and empty inputs', () => {
    expect(() => percentileAt(sorted, -0.01)).toThrow('stat: percentile must be within 0..100')
    expect(() => percentileAt(sorted, 1.01)).toThrow('stat: percentile must be within 0..100')
    expect(() => percentileAt([], 0.5)).toThrow('stat: percentile requires at least 1 value')
  })
})

describe('sortedCopy', () => {
  it('returns an ascending copy without mutating the input', () => {
    const input = [5, 3, 1, 4, 2]
    const out = sortedCopy(input)
    expect(out).toEqual([1, 2, 3, 4, 5])
    expect(out).not.toBe(input)
    expect(input).toEqual([5, 3, 1, 4, 2])
  })
})

describe('describeValues', () => {
  it('matches the design-doc example for [1,2,3,4,5] (D-01)', () => {
    expect(describeValues([1, 2, 3, 4, 5], false)).toEqual({
      action: 'describe',
      count: 5,
      sum: 15,
      min: 1,
      max: 5,
      mean: 3,
      median: 3,
      variance: 2,
      standardDeviation: 1.4142135623730951,
      q1: 2,
      q3: 4,
      iqr: 2,
      sample: false,
    })
  })

  it('supports population vs sample variance', () => {
    const pop = describeValues([1, 2, 3, 4], false)
    expect(pop.variance).toBeCloseTo(1.25, 12)
    expect(pop.standardDeviation).toBeCloseTo(Math.sqrt(1.25), 12)
    const samp = describeValues([1, 2, 3, 4], true)
    expect(samp.sample).toBe(true)
    expect(samp.variance).toBeCloseTo(5 / 3, 12)
    expect(samp.standardDeviation).toBeCloseTo(Math.sqrt(5 / 3), 12)
  })

  it('handles negative values and duplicates', () => {
    const r = describeValues([-2, -1, -1, 0, 3], false)
    expect(r.sum).toBe(-1)
    expect(r.min).toBe(-2)
    expect(r.max).toBe(3)
    expect(r.median).toBe(-1)
    expect(r.q1).toBe(-1)
    expect(r.q3).toBe(0)
    expect(r.iqr).toBe(1)
  })

  it('single-element input', () => {
    const r = describeValues([7], false)
    expect(r).toMatchObject({
      count: 1, sum: 7, min: 7, max: 7, mean: 7, median: 7,
      variance: 0, standardDeviation: 0, q1: 7, q3: 7, iqr: 0,
    })
  })

  it('keeps the compensated mean for mixed magnitudes (D-01)', () => {
    const r = describeValues([1e16, 1, -1e16], false)
    expect(r.sum).toBe(1)
    expect(r.mean).toBeCloseTo(1 / 3, 12)
    expect(r.count).toBe(3)
  })

  it('normalizes -0 in every numeric output field', () => {
    const r = describeValues([-0, 0], false)
    expect(Object.is(r.sum, -0)).toBe(false)
    expect(Object.is(r.min, -0)).toBe(false)
    expect(Object.is(r.max, -0)).toBe(false)
    expect(Object.is(r.mean, -0)).toBe(false)
    expect(r.sum).toBe(0)
    expect(r.min).toBe(0)
    expect(r.max).toBe(0)
  })

  it('does not modify the input array', () => {
    const input = [5, 3, 1, 4, 2]
    describeValues(input, false)
    expect(input).toEqual([5, 3, 1, 4, 2])
  })

  it('reports numeric-overflow instead of emitting Infinity', () => {
    expect(() => describeValues([Number.MAX_VALUE, Number.MAX_VALUE], false))
      .toThrow('stat: numeric-overflow')
  })
})
