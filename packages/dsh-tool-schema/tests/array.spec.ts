/**
 * 数组验证：items（schema/boolean）、minItems/maxItems、uniqueItems 结构相等、
 * 元素路径。
 */

import { describe, expect, it } from 'vitest'
import { validateCore } from '../src/validator.ts'

const opts = { maxErrors: 100, strictSchema: true }

describe('items', () => {
  it('validates every element with its index path', async () => {
    const schema = { type: 'array', items: { type: 'integer' } }
    expect((await validateCore([1, 2, 3], schema, opts)).valid).toBe(true)
    const r = await validateCore([1, 'x', 3], schema, opts)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]?.instancePath).toBe('/1')
    expect(r.errors[0]?.schemaPath).toBe('#/items/type')
  })

  it('supports nested arrays', async () => {
    const schema = { type: 'array', items: { type: 'array', items: { type: 'string' } } }
    expect((await validateCore([['a'], ['b', 'c']], schema, opts)).valid).toBe(true)
    const r = await validateCore([['a'], [1]], schema, opts)
    expect(r.errors[0]?.instancePath).toBe('/1/0')
  })

  it('boolean items true/false', async () => {
    expect((await validateCore([1, 'x'], { items: true }, opts)).valid).toBe(true)
    const r = await validateCore([1], { items: false }, opts)
    expect(r.errors[0]?.code).toBe('boolean-false')
    expect(r.errors[0]?.instancePath).toBe('/0')
  })

  it('items does not apply to non-arrays', async () => {
    const r = await validateCore({ 0: 'x' }, { items: { type: 'integer' } }, opts)
    expect(r.valid).toBe(true)
  })
})

describe('minItems / maxItems', () => {
  it('enforces bounds', async () => {
    expect((await validateCore([1], { minItems: 1 }, opts)).valid).toBe(true)
    expect((await validateCore([], { minItems: 1 }, opts)).valid).toBe(false)
    expect((await validateCore([1, 2, 3], { maxItems: 2 }, opts)).valid).toBe(false)
    expect((await validateCore([1, 2], { maxItems: 2 }, opts)).valid).toBe(true)
    // 非数组不受影响
    expect((await validateCore('abc', { minItems: 99 }, opts)).valid).toBe(true)
  })
})

describe('uniqueItems', () => {
  it('detects duplicates with structural equality', async () => {
    const schema = { type: 'array', uniqueItems: true }
    expect((await validateCore([1, 2, 3], schema, opts)).valid).toBe(true)
    expect((await validateCore([1, 1], schema, opts)).valid).toBe(false)
    // 对象键顺序无关的结构相等
    expect((await validateCore([{ a: 1, b: 2 }, { b: 2, a: 1 }], schema, opts)).valid).toBe(false)
    // 嵌套数组
    expect((await validateCore([[1], [1]], schema, opts)).valid).toBe(false)
    expect((await validateCore([[1], [2]], schema, opts)).valid).toBe(true)
  })

  it('reports the duplicate index', async () => {
    const r = await validateCore(['a', 'b', 'a'], { uniqueItems: true }, opts)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]?.instancePath).toBe('/2')
    expect(r.errors[0]?.code).toBe('unique-items')
  })

  it('uniqueItems:false is a no-op', async () => {
    expect((await validateCore([1, 1], { uniqueItems: false }, opts)).valid).toBe(true)
  })
})
