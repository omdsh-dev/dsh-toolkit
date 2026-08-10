import { describe, expect, it } from 'vitest'
import { midranks, correlationValues } from '../src/correlation.ts'

describe('midranks', () => {
  it('ranks distinct values in original order', () => {
    expect(midranks([3, 1, 2])).toEqual([3, 1, 2])
    expect(midranks([10, 20, 30, 40])).toEqual([1, 2, 3, 4])
  })

  it('uses midrank for ties (C-01)', () => {
    expect(midranks([1, 1, 2])).toEqual([1.5, 1.5, 3])
    expect(midranks([2, 1, 2, 1])).toEqual([3.5, 1.5, 3.5, 1.5])
  })

  it('constant series get the middle rank everywhere', () => {
    expect(midranks([2, 2, 2])).toEqual([2, 2, 2])
  })

  it('does not modify the input array', () => {
    const input = [3, 1, 2]
    midranks(input)
    expect(input).toEqual([3, 1, 2])
  })
})

describe('pearson correlation', () => {
  it('perfect positive correlation', () => {
    const r = correlationValues([1, 2, 3], [1, 2, 3], 'pearson')
    expect(r).toEqual({ action: 'correlation', method: 'pearson', count: 3, defined: true, value: 1, reason: null })
  })

  it('perfect negative correlation', () => {
    const r = correlationValues([1, 2, 3, 4, 5], [-1, -2, -3, -4, -5], 'pearson')
    expect(r.defined).toBe(true)
    expect(r.value).toBe(-1)
  })

  it('linear scaling keeps r = 1', () => {
    const r = correlationValues([1, 2, 3, 4], [2, 4, 6, 8], 'pearson')
    expect(r.value).toBe(1)
  })

  it('monotonic non-linear relationship has |r| < 1 (C-02)', () => {
    const r = correlationValues([1, 2, 3, 4, 5], [1, 4, 9, 16, 25], 'pearson')
    expect(r.defined).toBe(true)
    expect(r.value).toBeCloseTo(60 / Math.sqrt(3740), 12)
    expect(Math.abs(r.value as number)).toBeLessThan(1)
  })

  it('zero variance on either series -> defined:false, zero-variance (C-03)', () => {
    const a = correlationValues([2, 2, 2], [1, 2, 3], 'pearson')
    expect(a).toEqual({ action: 'correlation', method: 'pearson', count: 3, defined: false, value: null, reason: 'zero-variance' })
    const b = correlationValues([1, 2, 3], [5, 5, 5], 'pearson')
    expect(b.defined).toBe(false)
    expect(b.reason).toBe('zero-variance')
  })
})

describe('spearman correlation', () => {
  it('monotonic non-linear relationship scores 1 (C-02)', () => {
    const r = correlationValues([1, 2, 3, 4, 5], [1, 4, 9, 16, 25], 'spearman')
    expect(r.method).toBe('spearman')
    expect(r.defined).toBe(true)
    expect(r.value).toBe(1)
  })

  it('ties use midrank', () => {
    const r = correlationValues([1, 1, 2, 2, 3], [1, 2, 1, 2, 3], 'spearman')
    expect(r.defined).toBe(true)
    expect(r.value).toBeCloseTo(5 / 9, 12)
  })

  it('constant series -> zero-variance', () => {
    const r = correlationValues([1, 1, 1], [1, 2, 3], 'spearman')
    expect(r.defined).toBe(false)
    expect(r.reason).toBe('zero-variance')
  })

  it('perfect negative monotonic scores -1', () => {
    const r = correlationValues([1, 2, 3, 4], [10, 8, 6, 4], 'spearman')
    expect(r.value).toBe(-1)
  })
})

describe('correlationValues general contract', () => {
  it('reports count = paired length', () => {
    const r = correlationValues([1, 2, 3, 4], [4, 3, 2, 1], 'pearson')
    expect(r.count).toBe(4)
  })

  it('does not modify either input array', () => {
    const x = [1, 2, 3]
    const y = [3, 1, 2]
    correlationValues(x, y, 'pearson')
    correlationValues(x, y, 'spearman')
    expect(x).toEqual([1, 2, 3])
    expect(y).toEqual([3, 1, 2])
  })
})
