import { describe, expect, it } from 'vitest'
import {
  MAX_INPUT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_JSON_DEPTH,
  MAX_CSV_ROWS,
  MAX_CSV_COLUMNS,
  utf8ByteLength,
  normalizeMaxChanges,
  normalizeContext,
  assertInputSize,
  assertOutputSize,
} from '../src/limits.ts'

describe('limits: 字节预算', () => {
  it('utf8ByteLength 正确计算多字节字符', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('中文')).toBe(6)
    expect(utf8ByteLength('a中🚀')).toBe(1 + 3 + 4)
    expect(utf8ByteLength('')).toBe(0)
  })

  it('输入刚好达到上限不报错', () => {
    const s = 'a'.repeat(MAX_INPUT_BYTES)
    expect(() => assertInputSize(s, 'before')).not.toThrow()
  })

  it('输入超过上限报错', () => {
    const s = 'a'.repeat(MAX_INPUT_BYTES + 1)
    expect(() => assertInputSize(s, 'before')).toThrow(/exceeds/)
  })

  it('输出达到 64KiB 边界', () => {
    const s = 'a'.repeat(MAX_OUTPUT_BYTES)
    expect(() => assertOutputSize(s)).not.toThrow()
    const s2 = 'a'.repeat(MAX_OUTPUT_BYTES + 1)
    expect(() => assertOutputSize(s2)).toThrow(/exceeds/)
  })
})

describe('limits: 参数规范化', () => {
  it('maxChanges 非法值回退默认 1000', () => {
    expect(normalizeMaxChanges(0)).toBe(1000)
    expect(normalizeMaxChanges(-5)).toBe(1000)
    expect(normalizeMaxChanges(1.9)).toBe(1)
    expect(normalizeMaxChanges(undefined)).toBe(1000)
    expect(normalizeMaxChanges('x' as never)).toBe(1000)
  })

  it('maxChanges 超过硬顶被钳制到 10000', () => {
    expect(normalizeMaxChanges(50000)).toBe(10000)
  })

  it('context 限制到 0..20，非法回退 3', () => {
    expect(normalizeContext(-1)).toBe(0)
    expect(normalizeContext(0)).toBe(0)
    expect(normalizeContext(21)).toBe(20)
    expect(normalizeContext(3.7)).toBe(3)
    expect(normalizeContext(undefined)).toBe(3)
    expect(normalizeContext('x' as never)).toBe(3)
  })

  it('JSON 深度超过 64 时报错', async () => {
    const { jsonDiffText } = await import('../src/json-diff.ts')
    const deep = '{"a":'.repeat(70) + '1' + '}'.repeat(70)
    expect(() => jsonDiffText(deep, deep)).toThrow(/nesting exceeds/)
  })

  it('CSV 行数超过上限报错', async () => {
    const { parseCsv } = await import('../src/csv-diff.ts')
    const many = 'x\n'.repeat(MAX_CSV_ROWS + 1)
    expect(() => parseCsv(many)).toThrow(/rows/)
  })

  it('CSV 列数超过上限报错', async () => {
    const { parseCsv } = await import('../src/csv-diff.ts')
    const wide = 'a,'.repeat(MAX_CSV_COLUMNS) + 'z'
    expect(() => parseCsv(wide)).toThrow(/columns/)
  })
})
