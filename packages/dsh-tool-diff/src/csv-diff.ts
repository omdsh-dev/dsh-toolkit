/**
 * CSV 结构化 diff —— 零依赖，纯函数。
 *
 * - RFC4180 风格解析（引号包裹、"" 转义、CRLF/LF、带引号字段内换行、BOM 忽略）；
 * - 双模式：
 *   - keyed：首行表头 + 指定 key 列（列名或 1-based 索引）——按 key 匹配行；
 *   - positional：未提供 key —— 按行号位置比较，报告中 mode 注明；
 * - 重复 key 不静默覆盖：放入 duplicateKeys 且 equal=false；
 * - 列集合变化单独报告 addedColumns / removedColumns；缺失列值统一为 null；
 * - 行顺序默认不影响 keyed 结果。
 */

import { assertInputSize, MAX_CSV_ROWS, MAX_CSV_COLUMNS } from './limits.ts'

export interface CsvRow {
  /** 数据行号（1-based，不含表头行号语义，仅定位用） */
  line: number
  cells: string[]
}

export interface CsvChangeEntry {
  column: string
  before?: string | null
  after?: string | null
}

export interface CsvReport {
  mode: 'keyed' | 'positional'
  key?: string
  columns?: string[]
  equal: boolean
  addedRows: Array<Record<string, unknown>>
  removedRows: Array<Record<string, unknown>>
  changedRows: Array<{ key: string; changes: CsvChangeEntry[] }>
  duplicateKeys: string[]
  addedColumns: string[]
  removedColumns: string[]
  truncated?: boolean
}

export interface CsvParseResult {
  header: string[] | null
  rows: CsvRow[]
}

/** 解析 CSV 文本（RFC4180 风格，支持自定义分隔符）。返回表头（若多行）与数据行。 */
export function parseCsv(text: string, delimiter: string = ','): CsvParseResult {
  assertInputSize(text, 'csv')
  if (delimiter.length !== 1) throw new Error('diff: delimiter must be a single character')
  if (delimiter === '"' || delimiter === '\n' || delimiter === '\r') {
    throw new Error('diff: delimiter must not be a quote or newline character')
  }
  let normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (normalized.charCodeAt(0) === 0xfeff) normalized = normalized.slice(1)
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false
  let i = 0
  const n = normalized.length
  let sawAny = false
  while (i < n) {
    const ch = normalized[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"' && field === '') { inQuotes = true; i++; continue }
    if (ch === delimiter) { record.push(field); field = ''; i++; continue }
    if (ch === '\n') {
      record.push(field); field = ''
      records.push(record); record = []
      sawAny = true
      i++; continue
    }
    field += ch; i++
  }
  if (inQuotes) {
    throw new Error('diff: csv parse error: unterminated quoted field')
  }
  if (field !== '' || record.length > 0 || (!sawAny && normalized !== '')) {
    record.push(field)
    records.push(record)
  }
  if (records.length === 0) return { header: null, rows: [] }
  if (records.length > MAX_CSV_ROWS) {
    throw new Error(`diff: csv exceeds ${MAX_CSV_ROWS} rows`)
  }
  const width = Math.max(...records.map(r => r.length))
  if (width > MAX_CSV_COLUMNS) {
    throw new Error(`diff: csv exceeds ${MAX_CSV_COLUMNS} columns`)
  }
  const header = records.length >= 1 && records[0]!.length > 0 && records[0]!.some(c => c.trim() !== '')
    ? records[0]!.map((c, idx) => (c.trim() === '' ? `column${idx + 1}` : c.trim()))
    : null
  const rows: CsvRow[] = header === null
    ? records.map((cells, idx) => ({ line: idx + 1, cells }))
    : records.slice(1).map((cells, idx) => ({ line: idx + 2, cells }))
  return { header, rows }
}

function normalizeCell(v: string, ignoreCase: boolean, ignoreWhitespace: boolean): string {
  let out = v
  if (ignoreCase) out = out.toLowerCase()
  if (ignoreWhitespace) out = out.trim()
  return out
}

function cellsEqual(a: string[], b: string[], ignoreCase: boolean, ignoreWhitespace: boolean): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (normalizeCell(a[i]!, ignoreCase, ignoreWhitespace) !== normalizeCell(b[i]!, ignoreCase, ignoreWhitespace)) return false
  }
  return true
}

export interface CsvDiffOptions {
  /** key 列名（表头模式）或 1-based 列序号；缺省 → positional 模式 */
  key?: string
  delimiter?: string
  ignoreCase?: boolean
  ignoreWhitespace?: boolean
}

function resolveKeyIndex(header: string[] | null, key: string): number {
  const num = Number(key)
  if (!Number.isNaN(num) && /^\d+$/.test(key)) {
    const idx = num - 1
    if (idx < 0 || idx >= (header?.length ?? 0)) throw new Error(`diff: key column index ${key} out of range (${header?.length ?? 0} columns)`)
    return idx
  }
  if (header === null) throw new Error(`diff: named key "${key}" requires a header row`)
  const idx = header.indexOf(key)
  if (idx === -1) throw new Error(`diff: key column "${key}" not found in header ${JSON.stringify(header)}`)
  return idx
}

/** 把 cells 转成以表头为键的对象；缺失列 → null；多余列 → columnN。 */
function toRowObject(cells: string[], header: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {}
  for (let c = 0; c < header.length; c++) {
    obj[header[c]!] = cells[c] === undefined ? null : cells[c]
  }
  for (let c = header.length; c < cells.length; c++) {
    obj[`column${c + 1}`] = cells[c]
  }
  return obj
}

export function csvDiff(beforeText: string, afterText: string, options: CsvDiffOptions = {}): CsvReport {
  const delimiter = options.delimiter ?? ','
  const before = parseCsv(beforeText, delimiter)
  const after = parseCsv(afterText, delimiter)
  const ignoreCase = options.ignoreCase ?? false
  const ignoreWhitespace = options.ignoreWhitespace ?? false

  const report: CsvReport = {
    mode: 'positional',
    equal: false,
    addedRows: [],
    removedRows: [],
    changedRows: [],
    duplicateKeys: [],
    addedColumns: [],
    removedColumns: [],
  }

  // positional 模式：未提供 key（或 after 无表头）
  if (after.header === null || options.key === undefined) {
    const max = Math.max(before.rows.length, after.rows.length)
    for (let i = 0; i < max; i++) {
      const rb = before.rows[i]
      const ra = after.rows[i]
      const id = String(i + 1)
      if (!rb) report.addedRows.push({ row: id, cells: ra!.cells })
      else if (!ra) report.removedRows.push({ row: id, cells: rb.cells })
      else if (!cellsEqual(rb.cells, ra.cells, ignoreCase, ignoreWhitespace)) {
        report.changedRows.push({ key: id, changes: positionalCellChanges(rb.cells, ra.cells, ignoreCase, ignoreWhitespace) })
      }
    }
    report.equal = report.addedRows.length === 0 && report.removedRows.length === 0 && report.changedRows.length === 0
    return report
  }

  // keyed 模式
  const header = after.header
  const keyIndex = resolveKeyIndex(header, options.key)
  report.mode = 'keyed'
  report.key = header[keyIndex]
  report.columns = header

  // 列集合变化
  const beforeHeader = before.header
  if (beforeHeader) {
    for (const c of header) if (!beforeHeader.includes(c)) report.addedColumns.push(c)
    for (const c of beforeHeader) if (!header.includes(c)) report.removedColumns.push(c)
  } else {
    report.addedColumns = header.slice()
  }

  // D-05 修复：两侧统一索引；key 区分"缺失列"与"空字符串"（present/value 二元组）；
  // 任一侧出现重复 key → duplicateKeys 且 equal=false，重复 key 的行不参与匹配（结果确定）。
  const MISSING = '\u0001missing-key'
  const indexRows = (rows: CsvRow[]): { map: Map<string, CsvRow>; dupKeys: string[]; display: Map<string, string> } => {
    const map = new Map<string, CsvRow>()
    const counts = new Map<string, number>()
    const display = new Map<string, string>()
    for (const r of rows) {
      const present = keyIndex < r.cells.length
      const value = present ? r.cells[keyIndex]! : MISSING
      const k = `${present ? 'p' : 'm'}\u0000${value}`
      display.set(k, present ? value : '<missing-key>')
      counts.set(k, (counts.get(k) ?? 0) + 1)
      if (!map.has(k)) map.set(k, r)
    }
    const dupKeys: string[] = []
    for (const [k, c] of counts) {
      if (c > 1) dupKeys.push(k)
    }
    return { map, dupKeys, display }
  }
  const beforeIdx = indexRows(before.rows)
  const afterIdx = indexRows(after.rows)
  const dupSet = new Set<string>([...beforeIdx.dupKeys, ...afterIdx.dupKeys])
  report.duplicateKeys = [...dupSet].map(k => beforeIdx.display.get(k) ?? afterIdx.display.get(k) ?? k)

  const dupKeyOf = (r: CsvRow): string => {
    const present = keyIndex < r.cells.length
    return `${present ? 'p' : 'm'}\u0000${present ? r.cells[keyIndex]! : MISSING}`
  }
  for (const rb of before.rows) {
    const k = dupKeyOf(rb)
    if (dupSet.has(k)) continue // 重复 key 的行结果不确定，跳过
    const ra = afterIdx.map.get(k)
    if (!ra) {
      report.removedRows.push(toRowObject(rb.cells, header))
      continue
    }
    if (cellsEqual(rb.cells, ra.cells, ignoreCase, ignoreWhitespace)) continue
    const changes: CsvChangeEntry[] = []
    const width = Math.max(rb.cells.length, ra.cells.length)
    for (let c = 0; c < width; c++) {
      const bv = rb.cells[c]
      const av = ra.cells[c]
      const colName = header[c] ?? `column${c + 1}`
      if (bv === undefined) changes.push({ column: colName, before: null, after: av })
      else if (av === undefined) changes.push({ column: colName, before: bv, after: null })
      else if (normalizeCell(bv, ignoreCase, ignoreWhitespace) !== normalizeCell(av, ignoreCase, ignoreWhitespace)) {
        changes.push({ column: colName, before: bv, after: av })
      }
    }
    report.changedRows.push({ key: beforeIdx.display.get(k) ?? k, changes })
  }
  for (const r of after.rows) {
    const k = dupKeyOf(r)
    if (dupSet.has(k)) continue
    if (!beforeIdx.map.has(k)) {
      report.addedRows.push(toRowObject(r.cells, header))
    }
  }

  report.equal = report.addedRows.length === 0 && report.removedRows.length === 0 &&
    report.changedRows.length === 0 && report.duplicateKeys.length === 0 &&
    report.addedColumns.length === 0 && report.removedColumns.length === 0
  return report
}

function positionalCellChanges(before: string[], after: string[], ignoreCase: boolean, ignoreWhitespace: boolean): CsvChangeEntry[] {
  const changes: CsvChangeEntry[] = []
  const width = Math.max(before.length, after.length)
  for (let c = 0; c < width; c++) {
    const bv = before[c]
    const av = after[c]
    if (bv === undefined) changes.push({ column: `column${c + 1}`, before: null, after: av })
    else if (av === undefined) changes.push({ column: `column${c + 1}`, before: bv, after: null })
    else if (normalizeCell(bv, ignoreCase, ignoreWhitespace) !== normalizeCell(av, ignoreCase, ignoreWhitespace)) {
      changes.push({ column: `column${c + 1}`, before: bv, after: av })
    }
  }
  return changes
}
