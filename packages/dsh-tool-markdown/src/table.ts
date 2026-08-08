/**
 * 表格规范化 —— HTML <table> 或管道分隔文本 → GFM 表格。零依赖，纯函数。
 *
 * - HTML 输入：走 html.ts 解析，取第一个 <table>；
 * - 管道文本输入：首行为表头（已有分隔行则保留结构）；
 * - 列数不一致补空单元格；单元格内 '|' 转义；空单元格保留。
 */

import { parseHtml, type HtmlNode } from './html.ts'
import { tableToGfm, type Html2MdOptions } from './html2md.ts'
import { isSeparatorRow, splitPipe } from './md2html.ts'

export interface TableOptions extends Html2MdOptions {
  /** 仅支持 'gfm'（默认）。 */
  format?: string
}

function findTable(node: HtmlNode): HtmlNode | undefined {
  if (node.type === 'element' && node.tag === 'table') return node
  for (const c of node.children) {
    const found = findTable(c)
    if (found) return found
  }
  return undefined
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/** 行/列 → GFM 文本。 */
function toGfm(header: string[], body: string[][]): string {
  const width = Math.max(header.length, ...body.map(r => r.length))
  const pad = (r: string[]): string[] => {
    const out = [...r]
    while (out.length < width) out.push('')
    return out
  }
  const fmt = (cells: string[]): string => `| ${cells.map(c => escapePipe(c.trim())).join(' | ')} |`
  const lines = [fmt(pad(header)), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`]
  for (const r of body) lines.push(fmt(pad(r)))
  return lines.join('\n')
}

/** 任意分隔文本或 HTML table → GFM 表格文本。 */
export function normalizeTable(text: string, options: TableOptions = {}): string {
  const format = options.format ?? 'gfm'
  if (format !== 'gfm') {
    throw new Error(`markdown: table: unsupported format "${format}" (only "gfm")`)
  }
  const trimmed = text.trim()
  if (trimmed === '') {
    throw new Error('markdown: table: empty input')
  }

  // HTML 输入（含 '<' 标记形态；无 <table> 则报错）
  if (/<[a-z!?/]/i.test(trimmed)) {
    const root = parseHtml(trimmed)
    const table = findTable(root)
    if (!table) throw new Error('markdown: table: no <table> element found')
    return tableToGfm(table, options) + '\n'
  }

  // 管道分隔文本：必须至少含一个未转义的 '|'（审查 MD-06——避免把任意
  // 无管道文本默认为单列表格，与"管道分隔"契约不一致）
  if (!/(^|[^\\])\|/.test(trimmed)) {
    throw new Error('markdown: table: input must be an HTML <table> or pipe-delimited text (no "|" found)')
  }
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim() !== '')
  const rows = lines.map(splitPipe)
  let sepIndex = -1
  for (let i = 0; i < rows.length; i++) {
    if (isSeparatorRow(rows[i]!)) { sepIndex = i; break }
  }
  const header = rows[0]!
  const body = sepIndex === -1
    ? rows.slice(1)
    : [...rows.slice(1, sepIndex), ...rows.slice(sepIndex + 1)]
  return toGfm(header, body) + '\n'
}
