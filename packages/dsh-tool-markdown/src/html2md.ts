/**
 * DOM → Markdown（GFM 子集）—— 零依赖，纯函数。
 *
 * 映射：h1-h6/p/ul/ol/li/blockquote/pre/code/hr/br/a/img/strong/em/table；
 * 未知/容器元素（div/span/section…）递归透传。
 *
 * 安全：
 * - 链接 scheme 白名单（http/https/mailto；javascript:/data: 降级为纯文本）；
 * - baseUrl 提供时把相对 href/src 解析为绝对（naive join，文档注明限制）；
 * - 表格单元格内容中的 '|' 转义为 '\|'。
 */

import { parseHtml, type HtmlNode } from './html.ts'

export interface Html2MdOptions {
  /** 解析相对 href/src 的基准 URL（naive join）。 */
  baseUrl?: string
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/

/** URL 规范化（审查 MD-01/MD-02）：去除 C0 控制字符与首尾空白后再判断。 */
function normalizeUrl(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

/** scheme 白名单（大小写不敏感，审查 MD-02）；无 scheme 视为相对路径。 */
function safeScheme(rawUrl: string): boolean {
  const url = normalizeUrl(rawUrl)
  if (url === '') return false
  const m = SCHEME_RE.exec(url)
  if (!m) return true // 相对路径（无 scheme；协议相对 //host 属此类）
  const scheme = m[1]!.toLowerCase()
  return scheme === 'http' || scheme === 'https' || scheme === 'mailto'
}

function resolveUrl(href: string, baseUrl: string | undefined): string {
  const h = normalizeUrl(href)
  if (baseUrl === undefined || h === '' || SCHEME_RE.test(h)) return h
  const base = baseUrl.replace(/\/+$/, '')
  if (h.startsWith('/')) return base + h
  return `${base}/${h}`
}

function collapse(text: string): string {
  // 行内空白折叠为单空格（不 trim——块级边界处由调用方裁剪，行内元素间的空格必须保留）
  return text.replace(/[ \t\n\r\f]+/g, ' ')
}

/** 行首 Markdown 元字符转义（审查 MD-03）：防止文本被解释为标题/列表/引用。 */
function escapeLineStart(text: string): string {
  if (/^[#>+\-]/.test(text)) return `\\${text}`
  if (/^\d+\./.test(text)) return text.replace(/^(\d+)\./, '$1\\.') // 转义点号破坏有序列表
  return text
}

/** 行内文本 Markdown 元字符转义（审查 MD-03）。 */
function escapeInlineText(text: string): string {
  return text.replace(/[\\`*_[\]<>()]/g, '\\$&')
}

function escapePipe(text: string): string {
  return text.replace(/\|/g, '\\|')
}

/** 行内渲染：文本流拼接（空白折叠 + Markdown 元字符转义）。 */
function renderInline(node: HtmlNode, options: Html2MdOptions): string {
  if (node.type === 'text') return escapeInlineText(collapse(node.text ?? ''))
  const tag = node.tag ?? ''
  const children = node.children.map(c => renderInline(c, options)).join('')
  switch (tag) {
    case 'strong': case 'b': return `**${children}**`
    case 'em': case 'i': return `*${children}*`
    case 'code': {
      const inner = node.children.map(c => c.text ?? '').join('')
      return inner.includes('`') ? `\`\` ${inner} \`\`` : `\`${inner}\``
    }
    case 'a': {
      const href = resolveUrl(node.attrs['href'] ?? '', options.baseUrl)
      if (href === '' || !safeScheme(href)) return children // javascript:/data: 降级纯文本
      const title = node.attrs['title']
      return title ? `[${children}](${href} "${title.replace(/"/g, '\\"')}")` : `[${children}](${href})`
    }
    case 'img': {
      const src = resolveUrl(node.attrs['src'] ?? '', options.baseUrl)
      const alt = node.attrs['alt'] ?? ''
      if (src === '' || !safeScheme(src)) return alt // 危险 scheme：只留 alt
      const title = node.attrs['title']
      return title ? `![${alt}](${src} "${title.replace(/"/g, '\\"')}")` : `![${alt}](${src})`
    }
    case 'br': return '  \n'
    default:
      return children
  }
}

/** 行内标签（根层/容器内遇到时走行内渲染而非块级递归）。 */
const INLINE_TAGS = new Set([
  'a', 'img', 'strong', 'b', 'em', 'i', 'code', 'br', 'span', 'u', 's',
  'small', 'sub', 'sup', 'mark', 'abbr', 'time', 'label', 'q', 'cite',
  'kbd', 'samp', 'var', 'del', 'ins',
])

/** 块级渲染；返回多行文本（内部 '\n' 分隔，不含结尾空行）。 */
function renderBlock(node: HtmlNode, options: Html2MdOptions): string {
  if (node.type === 'text') return collapse(node.text ?? '')
  const tag = node.tag ?? ''
  switch (tag) {
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const level = Number(tag[1])
      return `${'#'.repeat(level)} ${renderInline(node, options).trim()}`
    }
    case 'p':
      return escapeLineStart(renderInline(node, options).trim())
    case 'hr':
      return '---'
    case 'blockquote': {
      const inner = node.children.map(c => {
        if (c.type === 'text') {
          // 文本保留行结构：逐行折叠后按行加前缀
          return (c.text ?? '').split(/\n+/).map(l => collapse(l).trim()).filter(Boolean).join('\n')
        }
        return renderBlock(c, options)
      }).join('\n\n')
      return inner.split('\n').map(l => `> ${l}`).join('\n')
    }
    case 'pre': {
      const codeText = (n: HtmlNode): string => {
        if (n.type === 'text') return n.text ?? ''
        return n.children.map(codeText).join('')
      }
      const code = codeText(node).replace(/\n+$/, '')
      const lang = /(?:^|\s)language-([a-zA-Z0-9_-]+)/.exec(node.attrs['class'] ?? '')?.[1]
      // 安全围栏（审查 MD-04）：内容含反引号时选用更长围栏，防止代码块逃逸
      const maxRun = (code.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0)
      const fence = '`'.repeat(Math.max(3, maxRun + 1))
      return `${fence}${lang ?? ''}\n${code}\n${fence}`
    }
    case 'ul': case 'ol': {
      return renderList(node, 0, options)
    }
    case 'table':
      return tableToGfm(node, options)
    case 'li':
      return renderInline(node, options).trim()
    default:
      // 行内标签（根层出现时）：行内渲染
      if (INLINE_TAGS.has(tag)) return renderInline(node, options)
      // 容器/未知元素：块级递归（文本子节点做行首转义）
      return node.children.map(c => {
        if (c.type === 'text') return escapeLineStart(collapse(c.text ?? ''))
        return renderBlock(c, options)
      }).filter(Boolean).join('\n\n')
  }
}

function renderList(node: HtmlNode, depth: number, options: Html2MdOptions): string {
  const ordered = node.tag === 'ol'
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  let counter = 1
  for (const child of node.children) {
    if (child.type !== 'element' || child.tag !== 'li') continue
    const itemText: string[] = []
    const nestedLists: string[] = []
    for (const c of child.children) {
      if (c.type === 'element' && (c.tag === 'ul' || c.tag === 'ol')) {
        // 嵌套列表已按 depth+1 缩进，直接追加（不重复加缩进）
        nestedLists.push(renderList(c, depth + 1, options))
      } else {
        const part = renderBlock(c, options)
        if (part !== '') itemText.push(part)
      }
    }
    const first = (itemText.shift() ?? '').trim()
    const marker = ordered ? `${counter}.` : '-'
    lines.push(`${indent}${marker} ${first}`)
    for (const rest of itemText) {
      lines.push(`${indent}  ${rest}`)
    }
    lines.push(...nestedLists)
    counter++
  }
  return lines.join('\n')
}

/** 提取表格行与单元格；colspan 用 N-1 个空单元格占位，行统一补齐到最大宽度。 */
function collectTable(grid: HtmlNode): string[][] {
  const rows: string[][] = []
  const walk = (n: HtmlNode): void => {
    if (n.type === 'element' && n.tag === 'tr') {
      const cells: string[] = []
      for (const c of n.children) {
        if (c.type !== 'element' || (c.tag !== 'td' && c.tag !== 'th')) continue
        cells.push(renderInline(c, {}))
        const span = Number.parseInt(c.attrs['colspan'] ?? '', 10)
        if (Number.isFinite(span) && span > 1) {
          for (let i = 1; i < span; i++) cells.push('')
        }
      }
      rows.push(cells)
      return
    }
    for (const c of n.children) walk(c)
  }
  walk(grid)
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0)
  for (const r of rows) {
    while (r.length < width) r.push('')
  }
  return rows
}

/** HTML <table> 节点 → GFM 表格文本（导出供 table 动作复用）。 */
export function tableToGfm(node: HtmlNode, options: Html2MdOptions = {}): string {
  const rows = collectTable(node)
  if (rows.length === 0) return ''
  // 表头：首行（thead 的 th 或首行 td）；其余为数据行
  const headerCells = rows[0]!
  const body = rows.slice(1)
  const width = Math.max(headerCells.length, ...body.map(r => r.length))
  const pad = (r: string[]): string[] => {
    const out = [...r]
    while (out.length < width) out.push('')
    return out
  }
  const fmt = (cells: string[]): string => `| ${cells.map(c => escapePipe(collapse(c).trim())).join(' | ')} |`
  const lines = [fmt(pad(headerCells)), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`]
  for (const r of body) lines.push(fmt(pad(r)))
  return lines.join('\n')
}

/** HTML → Markdown（GFM 子集）。 */
export function html2md(html: string, options: Html2MdOptions = {}): string {
  const root = parseHtml(html)
  const blocks = root.children.map(c => renderBlock(c, options)).filter(b => b !== '')
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n'
}
