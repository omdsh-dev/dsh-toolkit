import { describe, expect, it } from 'vitest'
import {
  validateStatArgs, MAX_OBSERVATIONS, MAX_PERCENTILES, MAX_DISTINCT,
} from '../src/validate.ts'

describe('validateStatArgs: shape and action', () => {
  it('rejects non-object args', () => {
    expect(() => validateStatArgs(null)).toThrow('stat: args must be an object')
    expect(() => validateStatArgs([1, 2])).toThrow('stat: args must be an object')
  })

  it('rejects missing or unknown action', () => {
    expect(() => validateStatArgs({ values: [1] })).toThrow('stat: unknown action')
    expect(() => validateStatArgs({ action: 'histogram', values: [1] })).toThrow('stat: unknown action "histogram"')
  })

  it('accepts all four actions with defaults', () => {
    for (const action of ['describe', 'percentile', 'frequency', 'correlation']) {
      const base: Record<string, unknown> = { action, values: [1, 2, 3] }
      if (action === 'percentile') base.percentiles = [50]
      if (action === 'correlation') base.other = [3, 2, 1]
      const r = validateStatArgs(base)
      expect(r.action).toBe(action)
      expect(r.sample).toBe(false)
      expect(r.method).toBe('pearson')
    }
  })
})

describe('validateStatArgs: values bounds and finiteness', () => {
  it('rejects empty values', () => {
    expect(() => validateStatArgs({ action: 'describe', values: [] }))
      .toThrow('stat: values must contain at least 1 number')
  })

  it(`rejects more than ${MAX_OBSERVATIONS} observations`, () => {
    const values = new Array<number>(MAX_OBSERVATIONS + 1).fill(1)
    expect(() => validateStatArgs({ action: 'describe', values }))
      .toThrow(`stat: values exceeds the ${MAX_OBSERVATIONS} observation limit`)
  })

  it('accepts exactly the maximum observation count', () => {
    const values = new Array<number>(MAX_OBSERVATIONS).fill(1)
    const r = validateStatArgs({ action: 'describe', values })
    expect(r.values.length).toBe(MAX_OBSERVATIONS)
  })

  it('rejects NaN / Infinity / -Infinity with a locatable message', () => {
    expect(() => validateStatArgs({ action: 'describe', values: [1, NaN, 3] }))
      .toThrow('stat: values[1] must be a finite number (got NaN)')
    expect(() => validateStatArgs({ action: 'describe', values: [Infinity, 2] }))
      .toThrow('stat: values[0] must be a finite number (got Infinity)')
    expect(() => validateStatArgs({ action: 'describe', values: [1, -Infinity] }))
      .toThrow('stat: values[1] must be a finite number (got -Infinity)')
    expect(() => validateStatArgs({ action: 'describe', values: ['1.5'] }))
      .toThrow('stat: values[0] must be a finite number (got 1.5)')
  })

  it('normalizes -0 to 0 without mutating the caller array (L-01)', () => {
    const values = [-0, 1, 2]
    const r = validateStatArgs({ action: 'describe', values })
    expect(r.values).toEqual([0, 1, 2])
    expect(Object.is(r.values[0], -0)).toBe(false)
    expect(values).toEqual([-0, 1, 2])
    expect(Object.is(values[0], -0)).toBe(true)
  })
})

describe('validateStatArgs: sample semantics', () => {
  it('rejects sample=true describe with a single value', () => {
    expect(() => validateStatArgs({ action: 'describe', values: [7], sample: true }))
      .toThrow('stat: sample variance requires at least 2 values')
  })

  it('accepts sample=true with two or more values', () => {
    expect(validateStatArgs({ action: 'describe', values: [1, 2], sample: true }).sample).toBe(true)
  })

  it('accepts a single value when sample is false (population)', () => {
    expect(validateStatArgs({ action: 'describe', values: [7] }).values).toEqual([7])
  })
})

describe('validateStatArgs: percentiles', () => {
  it('requires the percentiles array for the percentile action', () => {
    expect(() => validateStatArgs({ action: 'percentile', values: [1, 2, 3] }))
      .toThrow('stat: percentile requires the percentiles array')
    expect(() => validateStatArgs({ action: 'percentile', values: [1, 2, 3], percentiles: [] }))
      .toThrow('stat: percentile requires the percentiles array')
  })

  it(`rejects more than ${MAX_PERCENTILES} percentiles`, () => {
    const percentiles = new Array<number>(MAX_PERCENTILES + 1).fill(50)
    expect(() => validateStatArgs({ action: 'percentile', values: [1, 2, 3], percentiles }))
      .toThrow(`stat: percentiles exceeds the ${MAX_PERCENTILES} item limit`)
  })

  it('rejects out-of-range percentiles', () => {
    expect(() => validateStatArgs({ action: 'percentile', values: [1], percentiles: [101] }))
      .toThrow('stat: percentile must be within 0..100 (got 101)')
    expect(() => validateStatArgs({ action: 'percentile', values: [1], percentiles: [-1] }))
      .toThrow('stat: percentile must be within 0..100 (got -1)')
  })

  it('rejects non-finite percentiles', () => {
    expect(() => validateStatArgs({ action: 'percentile', values: [1], percentiles: [NaN] }))
      .toThrow('stat: percentiles[0] must be a finite number (got NaN)')
  })

  it('normalizes -0 percentile to 0 and accepts it', () => {
    const r = validateStatArgs({ action: 'percentile', values: [1, 2], percentiles: [-0] })
    expect(r.percentiles).toEqual([0])
    expect(Object.is(r.percentiles[0], -0)).toBe(false)
  })
})

describe('validateStatArgs: correlation pairing', () => {
  it('requires other for correlation', () => {
    expect(() => validateStatArgs({ action: 'correlation', values: [1, 2] }))
      .toThrow('stat: correlation requires the other array of paired observations')
  })

  it('rejects length mismatch with a locatable message', () => {
    expect(() => validateStatArgs({ action: 'correlation', values: [1, 2], other: [1, 2, 3] }))
      .toThrow('stat: other must have the same length as values (got 3, expected 2)')
  })

  it('rejects a single paired observation', () => {
    expect(() => validateStatArgs({ action: 'correlation', values: [1], other: [2] }))
      .toThrow('stat: correlation requires at least 2 paired observations')
  })

  it('rejects non-finite other values', () => {
    expect(() => validateStatArgs({ action: 'correlation', values: [1, 2], other: [3, Infinity] }))
      .toThrow('stat: other[1] must be a finite number (got Infinity)')
  })

  it('normalizes -0 in other and accepts a valid pair', () => {
    const r = validateStatArgs({ action: 'correlation', values: [1, 2], other: [-0, 3] })
    expect(r.other).toEqual([0, 3])
  })
})

describe('validateStatArgs: method and ignored params', () => {
  it('accepts spearman and rejects unknown methods', () => {
    expect(validateStatArgs({ action: 'correlation', values: [1, 2], other: [3, 4], method: 'spearman' }).method)
      .toBe('spearman')
    expect(() => validateStatArgs({ action: 'correlation', values: [1, 2], other: [3, 4], method: 'kendall' }))
      .toThrow('stat: method must be pearson or spearman')
  })

  it('ignores other for non-correlation actions (L-02)', () => {
    const r = validateStatArgs({ action: 'describe', values: [1, 2], other: [3, 4] })
    expect(r.other).toBeUndefined()
  })
})

describe('resource constants', () => {
  it('documents the resource boundaries', () => {
    expect(MAX_OBSERVATIONS).toBe(100000)
    expect(MAX_PERCENTILES).toBe(100)
    expect(MAX_DISTINCT).toBe(10000)
  })
})
