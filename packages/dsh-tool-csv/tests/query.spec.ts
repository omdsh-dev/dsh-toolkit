import { describe, expect, it } from 'vitest'
import { parseCsv } from '../src/parse.ts'
import { queryRows, statsGrid, toJsonRows, normalizeLimit } from '../src/query.ts'

const grid = (text: string) => parseCsv(text, { delimiter: ',', header: true }).rows

describe('queryRows', () => {
  const data = grid('name,city,age\nAlice,NYC,30\nBob,LA,25\nAlice,LA,31')

  it('filters by exact column name match', () => {
    const r = queryRows(data, { column: 'name', value: 'Alice', header: true, limit: 100 })
    expect(r.rows).toEqual([['name', 'city', 'age'], ['Alice', 'NYC', '30'], ['Alice', 'LA', '31']])
    expect(r.columns).toEqual(['name', 'city', 'age'])
  })

  it('filters by 1-based column index', () => {
    const r = queryRows(data, { column: '2', value: 'LA', header: true, limit: 100 })
    expect(r.rows).toEqual([['name', 'city', 'age'], ['Bob', 'LA', '25'], ['Alice', 'LA', '31']])
  })

  it('does exact equality, not substring', () => {
    const r = queryRows(data, { column: 'city', value: 'A', header: true, limit: 100 })
    expect(r.rows).toEqual([['name', 'city', 'age']]) // 只有表头，无匹配
  })

  it('returns only the header when nothing matches', () => {
    const r = queryRows(data, { column: 'name', value: 'Nobody', header: true, limit: 100 })
    expect(r.rows).toEqual([['name', 'city', 'age']])
  })

  it('respects limit on matched rows', () => {
    const r = queryRows(data, { column: 'city', value: 'LA', header: true, limit: 1 })
    expect(r.rows).toEqual([['name', 'city', 'age'], ['Bob', 'LA', '25']])
  })

  it('works with header=false using 1-based indexes (no header row in output)', () => {
    const arr = grid('Alice,NYC\nBob,LA')
    const r = queryRows(arr, { column: '1', value: 'Bob', header: false, limit: 100 })
    expect(r.rows).toEqual([['Bob', 'LA']])
    expect(r.columns).toEqual(['1', '2'])
  })

  it('errors on an unknown column name', () => {
    expect(() => queryRows(data, { column: 'nope', value: 'x', header: true, limit: 100 }))
      .toThrow('csv: column "nope" not found')
  })

  it('errors on an out-of-bounds index', () => {
    expect(() => queryRows(data, { column: '9', value: 'x', header: true, limit: 100 }))
      .toThrow('csv: column index 9 out of bounds (3 columns)')
  })

  it('errors on a non-numeric column when header=false', () => {
    expect(() => queryRows(grid('a,b'), { column: 'a', value: 'x', header: false, limit: 100 }))
      .toThrow('csv: header=false requires a 1-based numeric column')
  })

  it('rejects zero/negative/NaN limits by falling back to the default', () => {
    expect(normalizeLimit(0)).toBe(100)
    expect(normalizeLimit(-3)).toBe(100)
    expect(normalizeLimit(Number.NaN)).toBe(100)
    expect(normalizeLimit(undefined)).toBe(100)
    expect(normalizeLimit(5.9)).toBe(5)
  })

  it('errors on empty CSV', () => {
    expect(() => queryRows([], { column: '1', value: 'x', header: false, limit: 100 }))
      .toThrow('csv: empty CSV has no columns')
  })
})

describe('statsGrid', () => {
  it('reports rows/columns/columnNames/emptyRows for a header grid', () => {
    const r = parseCsv('name,city\nAlice,NYC\nBob,LA\n\n', { delimiter: ',', header: true })
    const s = statsGrid(r.rows, true, r.skippedBlank)
    expect(s.rows).toBe(2)
    expect(s.columns).toBe(2)
    expect(s.columnNames).toEqual(['name', 'city'])
    expect(s.emptyRows).toBe(1)
    expect(s.warnings).toEqual([])
  })

  it('reports duplicate column names as a warning', () => {
    const r = parseCsv('a,a,b\n1,2,3', { delimiter: ',', header: true })
    const s = statsGrid(r.rows, true, 0)
    expect(s.warnings[0]).toMatch(/duplicate column names: a/)
  })

  it('reports uneven rows (fewer/more fields) as warnings', () => {
    const r = parseCsv('a,b,c\n1\n2,3,4,5', { delimiter: ',', header: true })
    const s = statsGrid(r.rows, true, 0)
    expect(s.warnings).toContain('1 data row(s) have fewer fields than the header (missing fields filled with null)')
    expect(s.warnings).toContain('1 data row(s) have more fields than the header (extra fields merged into the last column)')
  })

  it('reports inconsistent widths when header=false', () => {
    const r = parseCsv('a,b\n1', { delimiter: ',', header: false })
    const s = statsGrid(r.rows, false, 0)
    expect(s.rows).toBe(2)
    expect(s.columns).toBe(2)
    expect(s.columnNames).toBeNull()
    expect(s.warnings[0]).toMatch(/inconsistent field counts/)
  })

  it('handles an empty grid', () => {
    const s = statsGrid([], true, 0)
    expect(s).toEqual({ rows: 0, columns: 0, columnNames: [], emptyRows: 0, warnings: [] })
  })
})

describe('toJsonRows', () => {
  it('maps header rows to objects with null for missing fields', () => {
    const r = parseCsv('a,b\n1\n2,3', { delimiter: ',', header: true })
    expect(toJsonRows(r.rows, true, ',', 100)).toEqual([
      { a: '1', b: null },
      { a: '2', b: '3' },
    ])
  })

  it('merges extra fields into the last column', () => {
    const r = parseCsv('a,b\n1,2,3,4', { delimiter: ',', header: true })
    expect(toJsonRows(r.rows, true, ',', 100)).toEqual([{ a: '1', b: '2,3,4' }])
  })

  it('lets later duplicate columns win', () => {
    const r = parseCsv('a,a\n1,2', { delimiter: ',', header: true })
    expect(toJsonRows(r.rows, true, ',', 100)).toEqual([{ a: '2' }])
  })

  it('returns arrays when header=false', () => {
    const r = parseCsv('1,2\n3,4', { delimiter: ',', header: false })
    expect(toJsonRows(r.rows, false, ',', 100)).toEqual([['1', '2'], ['3', '4']])
  })

  it('applies the limit to data rows (header still included)', () => {
    const r = parseCsv('a,b\n1,2\n3,4\n5,6', { delimiter: ',', header: true })
    expect(toJsonRows(r.rows, true, ',', 2)).toEqual([{ a: '1', b: '2' }, { a: '3', b: '4' }])
  })

  it('returns [] for an empty grid', () => {
    expect(toJsonRows([], true, ',', 100)).toEqual([])
  })

  // ── C-02：危险表头安全写入 ──

  it('serializes __proto__ headers without data loss (C-02)', () => {
    const r = parseCsv('__proto__\nvalue', { delimiter: ',', header: true })
    const rows = toJsonRows(r.rows, true, ',', 100) as Array<Record<string, string | null>>
    expect(Object.prototype.hasOwnProperty.call(rows[0], '__proto__')).toBe(true)
    expect(rows[0]!['__proto__']).toBe('value')
    expect(JSON.stringify(rows)).toBe('[{"__proto__":"value"}]')
  })

  it('handles constructor / prototype headers safely (C-02)', () => {
    const r = parseCsv('constructor,prototype\n1,2', { delimiter: ',', header: true })
    const rows = toJsonRows(r.rows, true, ',', 100) as Array<Record<string, string | null>>
    expect(JSON.stringify(rows)).toBe('[{"constructor":"1","prototype":"2"}]')
  })

  // ── C-03：十万行级压力（无 spread）──

  it('stats/query on 125k+ rows do not throw RangeError (C-03)', () => {
    const grid = Array.from({ length: 125_001 }, () => ['a'])
    expect(() => statsGrid(grid, false, 0)).not.toThrow()
    const s = statsGrid(grid, false, 0)
    expect(s.rows).toBe(125_001)
    expect(s.columns).toBe(1)
    // query 路径（header=false，列宽计算）同样无 spread
    const q = queryRows(grid, { column: '1', value: 'a', header: false, limit: 100 })
    expect(q.rows).toHaveLength(100)
    // header=true 路径
    const g2 = [['h'], ...grid]
    expect(() => statsGrid(g2, true, 0)).not.toThrow()
    expect(statsGrid(g2, true, 0).rows).toBe(125_001)
  })
})
