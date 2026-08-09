/**
 * JSON 结构化 diff —— 零依赖，纯函数。
 *
 * - 递归比较：标量直接比（可选 ignoreCase）；对象按 key（可选排序）
 *   输出 `$` 风格路径变更（`$.user.name`、`$.items[0]`、特殊键 `$['a.b']`）；
 *   数组按 index 比较；
 * - sortKeys 默认 true：变更列表按路径排序，输出可复现；
 * - 深度/体积预算：超过 MAX_JSON_DEPTH 或输入超限抛错（由 index.ts 转成工具错误）。
 */

import { assertInputSize } from './limits.ts'

export interface JsonChange {
  path: string
  /** 输出用字段名 op */
  kind: 'add' | 'remove' | 'replace'
  before?: unknown
  after?: unknown
}

export interface JsonDiffOptions {
  ignoreCase?: boolean
  sortKeys?: boolean
  maxDepth?: number
}

const DEFAULT_MAX_DEPTH = 64

function normalizeString(s: string, ignoreCase: boolean): string {
  if (ignoreCase) return s.toLowerCase()
  return s
}

function scalarEqual(a: unknown, b: unknown, ignoreCase: boolean): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    const na = normalizeString(a, ignoreCase)
    const nb = normalizeString(b, ignoreCase)
    if (ignoreCase) return na === nb
    // 不忽略大小写时仍按原始值比较
    return a === b
  }
  if (typeof a === 'number' && typeof b === 'number') {
    // NaN 视为相等（JSON 中不可能出现，但防御）
    if (Number.isNaN(a) && Number.isNaN(b)) return true
    return Object.is(a, b)
  }
  return a === b
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function typeOf(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

/** 生成子路径：对象键（特殊字符用单引号括号记法 `$['a.b']`）与数组下标。 */
function childPath(path: string, keyOrIndex: string | number): string {
  if (typeof keyOrIndex === 'number') return `${path}[${keyOrIndex}]`
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(keyOrIndex)) {
    return path === '$' ? `$.${keyOrIndex}` : `${path}.${keyOrIndex}`
  }
  const escaped = keyOrIndex.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  return `${path}['${escaped}']`
}

function diffPair(
  a: unknown,
  b: unknown,
  path: string,
  out: JsonChange[],
  options: JsonDiffOptions,
  depth: number,
): void {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  if (depth > maxDepth) {
    out.push({ path, kind: 'replace', before: a, after: b })
    return
  }
  if (a === b) return
  if (typeof a === 'string' && typeof b === 'string' && options.ignoreCase) {
    if (normalizeString(a, options.ignoreCase) === normalizeString(b, options.ignoreCase)) return
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) {
      const pa = i < a.length ? a[i] : undefined
      const pb = i < b.length ? b[i] : undefined
      if (i >= a.length) out.push({ path: childPath(path, i), kind: 'add', after: pb })
      else if (i >= b.length) out.push({ path: childPath(path, i), kind: 'remove', before: pa })
      else diffPair(pa, pb, childPath(path, i), out, options, depth + 1)
    }
    return
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    let keyList = [...keys]
    if (options.sortKeys !== false) keyList.sort()
    for (const k of keyList) {
      const hasA = Object.prototype.hasOwnProperty.call(a, k)
      const hasB = Object.prototype.hasOwnProperty.call(b, k)
      const childPath_ = childPath(path, k)
      if (!hasA) out.push({ path: childPath_, kind: 'add', after: b[k] })
      else if (!hasB) out.push({ path: childPath_, kind: 'remove', before: a[k] })
      else diffPair(a[k], b[k], childPath_, out, options, depth + 1)
    }
    return
  }
  // 类型不同或标量不等
  if (typeOf(a) !== typeOf(b)) {
    out.push({ path, kind: 'replace', before: a, after: b })
    return
  }
  if (!scalarEqual(a, b, options.ignoreCase ?? false)) {
    out.push({ path, kind: 'replace', before: a, after: b })
  }
}

export function jsonDiff(beforeJson: unknown, afterJson: unknown, options: JsonDiffOptions = {}): JsonChange[] {
  const out: JsonChange[] = []
  diffPair(beforeJson, afterJson, '$', out, options, 0)
  return out
}

/**
 * 扫描同一对象内重复键名（D-10 修复）：JSON.parse 会静默取最后值，
 * 这里用 O(n) 状态机在 parse 前记录重复键，随输出报告，不让结构化 diff 静默丢信息。
 */
export function scanDuplicateKeys(text: string): string[] {
  const dups: string[] = []
  const stack: Array<{ isObj: boolean; keys: Set<string> }> = []
  let inString = false
  let escaped = false
  let expectingKey = false
  let buf = ''
  const top = () => stack[stack.length - 1]
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') {
        inString = false
        if (expectingKey && top()?.isObj) {
          const t = top()!
          if (t.keys.has(buf) && !dups.includes(buf)) dups.push(buf)
          t.keys.add(buf)
        }
        expectingKey = false
        continue
      }
      if (expectingKey) buf += ch
      continue
    }
    if (ch === '"') { inString = true; buf = ''; continue }
    if (ch === '{') { stack.push({ isObj: true, keys: new Set() }); expectingKey = true; continue }
    if (ch === '[') { stack.push({ isObj: false, keys: new Set() }); expectingKey = false; continue }
    if (ch === '}' || ch === ']') { stack.pop(); expectingKey = false; continue }
    if (ch === ':') { expectingKey = false; continue }
    if (ch === ',') { expectingKey = top()?.isObj === true; continue }
  }
  return dups
}

/**
 * 扫描原始 JSON 文本的最大嵌套深度（跳过字符串字面量，O(n) 非递归）。
 * 用于在 JSON.parse 之前拦截超深输入（防调用栈溢出与超时）。
 */
export function scanJsonDepth(text: string): number {
  let depth = 0
  let maxDepth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (ch === '\\') { escaped = true; continue }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') {
      depth++
      if (depth > maxDepth) maxDepth = depth
      continue
    }
    if (ch === '}' || ch === ']') {
      depth--
      if (depth < 0) depth = 0
    }
  }
  return maxDepth
}

export function jsonDiffText(beforeText: string, afterText: string, options: JsonDiffOptions = {}): {
  changes: JsonChange[]
  beforeParsed: unknown
  afterParsed: unknown
  duplicateKeys: { before: string[]; after: string[] }
} {
  assertInputSize(beforeText, 'before')
  assertInputSize(afterText, 'after')
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  if (scanJsonDepth(beforeText) > maxDepth) {
    throw new Error(`diff: before json nesting exceeds ${maxDepth} levels`)
  }
  if (scanJsonDepth(afterText) > maxDepth) {
    throw new Error(`diff: after json nesting exceeds ${maxDepth} levels`)
  }
  const duplicateKeys = {
    before: scanDuplicateKeys(beforeText),
    after: scanDuplicateKeys(afterText),
  }
  let beforeParsed: unknown
  let afterParsed: unknown
  try {
    beforeParsed = JSON.parse(beforeText)
  } catch (e) {
    throw new Error(`diff: before is not valid JSON (${(e as Error).message})`)
  }
  try {
    afterParsed = JSON.parse(afterText)
  } catch (e) {
    throw new Error(`diff: after is not valid JSON (${(e as Error).message})`)
  }
  const changes = jsonDiff(beforeParsed, afterParsed, options)
  return { changes, beforeParsed, afterParsed, duplicateKeys }
}
