import { describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-tools', () => ({ defineTool: (opts: unknown) => opts }))
import { name, inject, apply, runStatAction } from '../src/index.ts'

describe('stat: plugin registration contract (AUDIT-CROSS-02)', () => {
  it('exports the cordis plugin contract', () => {
    expect(typeof name).toBe('string')
    expect(name).toBe('@deepseek-ai/dsh-tool-stat')
    expect(inject).toContain('tools')
    expect(typeof apply).toBe('function')
  })

  it('registers the stat tool with schema + json output', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    expect(def.name).toBe('stat')
    expect(def.parameters.action.required).toBe(true)
    expect(def.parameters.action.enum).toEqual(['describe', 'percentile', 'frequency', 'correlation'])
    expect(def.parameters.values.required).toBe(true)
    expect(def.parameters.values.type).toBe('array')
    expect(def.parameters.values.items).toEqual({ type: 'number' })
    expect(def.parameters.percentiles.type).toBe('array')
    expect(def.parameters.other.type).toBe('array')
    expect(def.parameters.method.enum).toEqual(['pearson', 'spearman'])
    expect(def.parameters.sample.type).toBe('boolean')
    expect(def.output.schema.type).toBe('json')
    expect(typeof def.output.render).toBe('function')
    expect(def.timeoutMs).toBe(2000)
  })

  it('render serializes the canonical value as a text block', () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    const value = { action: 'describe', count: 5, sum: 15 }
    expect(def.output.render({}, value)).toEqual([{ type: 'text', text: JSON.stringify(value) }])
  })

  it('execute is non-async and resolves the canonical value (R-01)', async () => {
    let captured: unknown
    const ctx: any = { tools: { register: (def: unknown) => { captured = def; return () => {} } } }
    apply(ctx)
    const def = captured as any
    const promise = def.execute({ action: 'describe', values: [1, 2, 3, 4, 5] })
    expect(promise).toBeInstanceOf(Promise)
    await expect(promise).resolves.toMatchObject({ action: 'describe', count: 5, sum: 15 })
  })
})

describe('stat: action dispatch (runStatAction)', () => {
  it('describe matches the design-doc example', () => {
    expect(runStatAction({ action: 'describe', values: [1, 2, 3, 4, 5] })).toEqual({
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

  it('correlation matches the design-doc example', () => {
    expect(runStatAction({ action: 'correlation', values: [1, 2, 3], other: [1, 2, 3] })).toEqual({
      action: 'correlation',
      method: 'pearson',
      count: 3,
      defined: true,
      value: 1,
      reason: null,
    })
  })

  it('percentile keeps request order', () => {
    const r = runStatAction({ action: 'percentile', values: [1, 2, 3, 4, 5], percentiles: [75, 25] })
    expect(r.action).toBe('percentile')
    expect((r as any).percentiles.map((e: any) => e.percentile)).toEqual([75, 25])
  })

  it('frequency reports distinct totals', () => {
    const r = runStatAction({ action: 'frequency', values: [1, 1, 2] })
    expect(r.action).toBe('frequency')
    expect((r as any).distinctTotal).toBe(2)
    expect((r as any).entries.map((e: any) => e.value)).toEqual([1, 2])
  })

  it('surfaces validation errors with a locatable message', () => {
    expect(() => runStatAction({ action: 'describe', values: [] }))
      .toThrow('stat: values must contain at least 1 number')
    expect(() => runStatAction({ action: 'correlation', values: [1, 2], other: [1] }))
      .toThrow('stat: other must have the same length as values')
  })
})
