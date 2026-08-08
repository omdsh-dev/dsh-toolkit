import { describe, expect, it } from 'vitest'
import { parseCsv, normalizeDelimiter, MAX_INPUT_BYTES } from '../src/parse.ts'

const base = { header: true } as const

describe('parseCsv: RFC 4180 边界', () => {
  it('parses a basic two-row grid', () => {
    expect(parseCsv('a,b\n1,2', { ...base, delimiter: ',' })).toEqual({
      rows: [['a', 'b'], ['1', '2']],
      skippedBlank: 0,
    })
  })

  it('keeps commas inside quoted fields', () => {
    const r = parseCsv('"x,y",z', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['x,y', 'z']])
  })

  it('decodes escaped quotes ("")', () => {
    const r = parseCsv('"a""b"', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['a"b']])
  })

  it('keeps newlines inside quoted fields (multi-line field)', () => {
    const r = parseCsv('"a\nb",c', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['a\nb', 'c']])
  })

  it('normalizes CRLF to single rows with no trailing empty row', () => {
    const r = parseCsv('a\r\nb\r\n', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['a'], ['b']])
    expect(r.skippedBlank).toBe(0)
  })

  it('treats a lone CR as a row terminator too', () => {
    const r = parseCsv('a\rb', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['a'], ['b']])
  })

  it('strips a leading UTF-8 BOM', () => {
    const r = parseCsv('\uFEFFa,b', { ...base, delimiter: ',' })
    expect(r.rows[0]).toEqual(['a', 'b'])
  })

  it('skips blank lines and reports the count', () => {
    const r = parseCsv('a\n\n\nb', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['a'], ['b']])
    expect(r.skippedBlank).toBe(2)
  })

  it('treats quotes mid-field as literals', () => {
    const r = parseCsv('a "b",c', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['a "b"', 'c']])
  })

  it('handles input without a trailing newline', () => {
    const r = parseCsv('a,b', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['a', 'b']])
  })

  it('supports tab as a delimiter', () => {
    const r = parseCsv('a\tb\n1\t2', { ...base, delimiter: '\t' })
    expect(r.rows).toEqual([['a', 'b'], ['1', '2']])
  })

  it('keeps empty fields inside a row (only fully-blank rows are skipped)', () => {
    const r = parseCsv('a,,c\n,,', { ...base, delimiter: ',' })
    expect(r.rows).toEqual([['a', '', 'c']])
    expect(r.skippedBlank).toBe(1)
  })

  it('rejects non-string input', () => {
    expect(() => parseCsv(42 as unknown as string, { ...base, delimiter: ',' })).toThrow('csv: csv must be a string')
  })

  it(`rejects input over ${MAX_INPUT_BYTES} bytes`, () => {
    const big = 'x'.repeat(MAX_INPUT_BYTES + 1)
    expect(() => parseCsv(big, { ...base, delimiter: ',' })).toThrow(`csv: input exceeds ${MAX_INPUT_BYTES} bytes`)
  })

  // ── C-01：严格引号策略 ──

  it('rejects unterminated quoted fields (C-01)', () => {
    expect(() => parseCsv('"a,b', { ...base, delimiter: ',' }))
      .toThrow('csv: unterminated quoted field')
  })

  it('rejects invalid characters after a closing quote (C-01)', () => {
    expect(() => parseCsv('"a"x,b', { ...base, delimiter: ',' }))
      .toThrow('csv: invalid character "x" after closing quote')
    expect(() => parseCsv('"a" ,b', { ...base, delimiter: ',' }))
      .toThrow('csv: invalid character " " after closing quote')
  })

  it('accepts a quoted field followed by delimiter / newline / EOF (C-01)', () => {
    expect(parseCsv('"a",b', { ...base, delimiter: ',' }).rows).toEqual([['a', 'b']])
    expect(parseCsv('"a"\n', { ...base, delimiter: ',' }).rows).toEqual([['a']])
    expect(parseCsv('"a"', { ...base, delimiter: ',' }).rows).toEqual([['a']])
    expect(parseCsv('"a"\r\n"b"', { ...base, delimiter: ',' }).rows).toEqual([['a'], ['b']])
  })
})

describe('normalizeDelimiter', () => {
  it('defaults to comma', () => {
    expect(normalizeDelimiter(undefined)).toBe(',')
  })

  it('maps "tab" to \\t', () => {
    expect(normalizeDelimiter('tab')).toBe('\t')
  })

  it('accepts a single character', () => {
    expect(normalizeDelimiter(';')).toBe(';')
  })

  it('rejects multi-character delimiters', () => {
    expect(() => normalizeDelimiter('||')).toThrow('csv: delimiter must be a single character or "tab"')
    expect(() => normalizeDelimiter(5)).toThrow('csv: delimiter must be a single character or "tab"')
  })

  it('rejects surrogate-pair (non-BMP) delimiters (C-04)', () => {
    // 😀 占 2 个 UTF-16 code unit；解析器按 code unit 比较，接受它会永远匹配不上
    expect(() => normalizeDelimiter('😀')).toThrow('csv: delimiter must be a single character or "tab"')
  })

  it('rejects control-character delimiters except tab (C-04)', () => {
    expect(() => normalizeDelimiter('\n')).toThrow(/control characters are not allowed/)
    expect(() => normalizeDelimiter('\r')).toThrow(/control characters are not allowed/)
    expect(() => normalizeDelimiter('\0')).toThrow(/control characters are not allowed/)
    expect(normalizeDelimiter('\t')).toBe('\t')
    expect(normalizeDelimiter(' ')).toBe(' ')
  })
})
