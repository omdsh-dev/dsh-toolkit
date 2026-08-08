/**
 * 轻量递归下降 HTML 解析器 —— 零依赖，纯函数。
 *
 * 覆盖模型场景的 95%：标签/属性/文本/注释/实体/自闭合/大小写归一；
 * 畸形输入容错（未闭合标签 EOF 自动闭合、未知标签跳过、块级自动闭合）。
 *
 * 安全边界：
 * - script/style/iframe/object/noscript/template 内容整体剥离（不产出节点）；
 * - 注释 / DOCTYPE / CDATA 剥离；
 * - 嵌套深度超过 maxDepth 直接报错（防栈溢出，不静默）；
 * - 实体解码在解析期完成（命名 + 数字），未知实体按字面保留。
 */

export interface HtmlNode {
  type: 'element' | 'text'
  /** element 时的标签名（已小写归一）。 */
  tag?: string
  /** 属性表（布尔属性值为 ''；值已实体解码）。 */
  attrs: Record<string, string>
  children: HtmlNode[]
  /** text 节点时的文本（已实体解码）。 */
  text?: string
}

/** 根节点 tag。 */
export const ROOT_TAG = '#root'

/** 自闭合标签（无 children）。 */
const SELF_CLOSING = new Set([
  'br', 'img', 'hr', 'meta', 'link', 'input', 'area', 'base', 'col',
  'embed', 'source', 'track', 'wbr',
])

/** 内容整体剥离的标签（安全 + 噪音）。 */
const STRIP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'noscript', 'template'])

/** 块级标签：新块级开标签会先关闭栈顶可自动闭合的块级（如 <p> 中遇 <div>）。 */
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'main',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'caption',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'form', 'hr',
  'figure', 'figcaption', 'dl', 'dt', 'dd', 'address', 'fieldset',
])

/** 遇新块级标签时的自动闭合规则（按标签细分，嵌套列表等合法结构不被误关）。 */
const AUTO_CLOSE_RULES: Record<string, (newTag: string) => boolean> = {
  p: newTag => BLOCK_TAGS.has(newTag),
  li: newTag => newTag === 'li',
  dt: newTag => newTag === 'dt' || newTag === 'dd',
  dd: newTag => newTag === 'dt' || newTag === 'dd',
  option: newTag => newTag === 'option',
}

/** 命名实体表（HTML 常用子集；其余按字面保留）。 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022', middot: '\u00b7',
  deg: '\u00b0', plusmn: '\u00b1', times: '\u00d7', divide: '\u00f7',
  euro: '\u20ac', pound: '\u00a3', yen: '\u00a5', cent: '\u00a2',
}

/** 解码单个实体引用体（不含 & 与 ;）。 */
function decodeEntity(inner: string): string | undefined {
  if (inner === '') return undefined
  if (inner[0] === '#') {
    const hex = inner[1] === 'x' || inner[1] === 'X'
    const digits = hex ? inner.slice(2) : inner.slice(1)
    if (digits === '' || !/^[0-9a-fA-F]+$/.test(digits)) return undefined
    const code = Number.parseInt(digits, hex ? 16 : 10)
    if (!Number.isFinite(code) || code > 0x10ffff) return undefined
    return String.fromCodePoint(code)
  }
  return NAMED_ENTITIES[inner]
}

/** 解码文本中的全部实体引用；未知实体按字面保留。 */
export function decodeEntities(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const amp = text.indexOf('&', i)
    if (amp === -1) { out += text.slice(i); break }
    out += text.slice(i, amp)
    const semi = text.indexOf(';', amp + 1)
    const candidate = semi === -1 ? text.slice(amp + 1) : text.slice(amp + 1, semi)
    // 实体名/数字串最多 12 字符，避免长串误吞
    if (candidate.length > 0 && candidate.length <= 12 && /^[#a-zA-Z0-9]+$/.test(candidate)) {
      const decoded = decodeEntity(candidate)
      if (decoded !== undefined) {
        out += decoded
        i = semi === -1 ? text.length : semi + 1
        continue
      }
    }
    out += '&'
    i = amp + 1
  }
  return out
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f'])

/** 标签名：ASCII 字母开头，字母/数字/-；非法时返回 undefined。 */
function parseTagName(input: string, start: number): { name: string; end: number } | undefined {
  const c0 = input.charCodeAt(start)
  const isLetter = (c: number): boolean => (c >= 97 && c <= 122) || (c >= 65 && c <= 90)
  if (!isLetter(c0)) return undefined
  let i = start + 1
  while (i < input.length) {
    const c = input.charCodeAt(i)!
    if (isLetter(c) || (c >= 48 && c <= 57) || c === 45) i++
    else break
  }
  return { name: input.slice(start, i).toLowerCase(), end: i }
}

export interface ParseOptions {
  maxDepth?: number
}

/**
 * 解析 HTML 片段为树；畸形输入容错。根节点 tag 为 '#root'。
 * 深度超过 maxDepth（默认 64）抛 `markdown: HTML nesting exceeds ...` 错误。
 */
export function parseHtml(input: string, options: ParseOptions = {}): HtmlNode {
  const maxDepth = options.maxDepth ?? 64
  const root: HtmlNode = { type: 'element', tag: ROOT_TAG, attrs: {}, children: [] }
  const stack: HtmlNode[] = [root]
  let i = 0
  const len = input.length

  const top = (): HtmlNode => stack[stack.length - 1]!

  const pushText = (text: string): void => {
    if (text === '') return
    const decoded = decodeEntities(text)
    const parent = top()
    const last = parent.children[parent.children.length - 1]
    if (last && last.type === 'text') {
      last.text = (last.text ?? '') + decoded // 合并相邻文本节点
      return
    }
    parent.children.push({ type: 'text', attrs: {}, children: [], text: decoded })
  }

  while (i < len) {
    const lt = input.indexOf('<', i)
    if (lt === -1) { pushText(input.slice(i)); break }
    if (lt > i) pushText(input.slice(i, lt))
    i = lt + 1

    // 注释
    if (input.startsWith('!--', i)) {
      const end = input.indexOf('-->', i)
      if (end === -1) break // 未闭合注释：忽略余下内容
      i = end + 3
      continue
    }
    // DOCTYPE / 处理指令
    if (input[i] === '!' || input[i] === '?') {
      const end = input.indexOf('>', i)
      if (end === -1) break
      i = end + 1
      continue
    }
    // CDATA：剥离内容
    if (input.startsWith('![CDATA[', i)) {
      const end = input.indexOf(']]>', i)
      if (end === -1) break
      i = end + 3
      continue
    }
    // 闭合标签
    if (input[i] === '/') {
      const tag = parseTagName(input, i + 1)
      if (tag) {
        for (let s = stack.length - 1; s >= 1; s--) {
          if (stack[s]!.tag === tag.name) { stack.length = s; break }
        }
        const gt = input.indexOf('>', tag.end)
        i = gt === -1 ? len : gt + 1
        continue
      }
      pushText('</') // i 保持在 '<' 后一位，下轮循环继续处理该字符
      continue
    }

    // 开标签
    const tag = parseTagName(input, i)
    if (!tag) { pushText('<'); continue }

    // 解析属性直到 '>' 或 '/>'
    let j = tag.end
    const attrs: Record<string, string> = {}
    let selfClosing = false
    while (j < len) {
      const c = input[j]!
      if (c === '>') { j++; break }
      if (c === '/' && input[j + 1] === '>') { selfClosing = true; j += 2; break }
      if (WHITESPACE.has(c)) { j++; continue }
      // 属性名
      let k = j
      while (k < len && !WHITESPACE.has(input[k]!) && input[k] !== '=' && input[k] !== '>'
        && !(input[k] === '/' && input[k + 1] === '>')) k++
      if (k === j) { j++; continue } // 意外字符，跳过
      const name = input.slice(j, k).toLowerCase()
      j = k
      while (j < len && WHITESPACE.has(input[j]!)) j++
      if (input[j] === '=') {
        j++
        while (j < len && WHITESPACE.has(input[j]!)) j++
        const q = input[j]
        if (q === '"' || q === "'") {
          const close = input.indexOf(q, j + 1)
          if (close === -1) { attrs[name] = decodeEntities(input.slice(j + 1)); j = len }
          else { attrs[name] = decodeEntities(input.slice(j + 1, close)); j = close + 1 }
        } else {
          let v = j
          while (v < len && !WHITESPACE.has(input[v]!) && input[v] !== '>'
            && !(input[v] === '/' && input[v + 1] === '>')) v++
          attrs[name] = decodeEntities(input.slice(j, v))
          j = v
        }
      } else {
        attrs[name] = '' // 布尔属性
      }
    }
    i = j

    if (STRIP_TAGS.has(tag.name)) {
      // 内容整体剥离：跳到匹配的闭合标签
      if (!selfClosing) {
        const rest = input.slice(i)
        const closeRe = new RegExp(`</${tag.name}[\\s>]`, 'i')
        const m = closeRe.exec(rest)
        if (m) {
          const closeEnd = rest.indexOf('>', m.index)
          i = i + (closeEnd === -1 ? m.index + m[0].length : closeEnd + 1)
        } else {
          i = len
        }
      }
      continue
    }

    const node: HtmlNode = { type: 'element', tag: tag.name, attrs, children: [] }

    if (selfClosing || SELF_CLOSING.has(tag.name)) {
      top().children.push(node)
      continue
    }

    // 块级自动闭合：按规则关闭栈顶弱块级（如 <p> 中遇 <div>；<li> 只被新 <li> 关闭）
    if (BLOCK_TAGS.has(tag.name)) {
      while (stack.length > 1) {
        const t = stack[stack.length - 1]!.tag
        const rule = t !== undefined ? AUTO_CLOSE_RULES[t] : undefined
        if (rule && rule(tag.name)) stack.pop()
        else break
      }
    }

    if (stack.length - 1 >= maxDepth) {
      throw new Error(`markdown: HTML nesting exceeds ${maxDepth} levels (malformed input)`)
    }
    top().children.push(node)
    stack.push(node)
  }

  return root
}
