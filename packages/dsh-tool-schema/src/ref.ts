/**
 * 本地 `$ref` / JSON Pointer —— 仅支持 `#` 与 `#/$defs/<escaped-token>...`。
 *
 * 设计文档 §5.6：
 * - 使用 RFC 6901 token 解码（`~1` → `/`，`~0` → `~`，先处理 `~1` 再 `~0`）；
 * - 禁止外部 URI、绝对路径和相对文件路径；
 * - 解析后节点必须存在；
 * - 引用链最大 64；纯 `$ref` 环必须报 `ref-cycle`（静态检测在 schema-check，
 *   动态兜底在 validator 的 (schemaNode, instance) 栈检测）。
 *
 * 安全属性：全部对象访问使用 Object.hasOwn，`__proto__`/`constructor` 等键
 * 只能作为普通 JSON 键命中，绝不上溯原型链。
 */

export interface ParsedRef {
  ok: true
  /** 解码后的 token 序列（`#` 为空数组）。 */
  tokens: string[]
}

export interface RefParseFailure {
  ok: false
  code: 'ref-invalid'
  message: string
}

export type ParseRefResult = ParsedRef | RefParseFailure

/** RFC 6901 token 解码；非法转义（`~` 后非 0/1）返回 null。 */
export function unescapeToken(token: string): string | null {
  let out = ''
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '~') {
      const next = token[i + 1]
      if (next === '0') {
        out += '~'
        i++
      } else if (next === '1') {
        out += '/'
        i++
      } else {
        return null
      }
    } else {
      out += c
    }
  }
  return out
}

/**
 * 解析 `$ref` 字符串。只接受 `#` 与 `#/...`；`#foo`（anchor 形式）、
 * 非 `#` 开头（远程/绝对/相对路径）一律拒绝。
 */
export function parseRef(ref: string): ParseRefResult {
  if (ref === '#') return { ok: true, tokens: [] }
  if (!ref.startsWith('#')) {
    return {
      ok: false,
      code: 'ref-invalid',
      message: 'remote/absolute/relative refs are not supported; only "#" or "#/$defs/<token>"',
    }
  }
  if (!ref.startsWith('#/')) {
    return { ok: false, code: 'ref-invalid', message: `unsupported ref form "${ref}"; only "#" or "#/..." pointers are supported` }
  }
  const rawTokens = ref.slice(2).split('/')
  const tokens: string[] = []
  for (const raw of rawTokens) {
    const decoded = unescapeToken(raw)
    if (decoded === null) {
      return { ok: false, code: 'ref-invalid', message: `invalid JSON Pointer escape in "${ref}"` }
    }
    tokens.push(decoded)
  }
  return { ok: true, tokens }
}

export interface ResolvedRef {
  ok: true
  value: unknown
}

export interface RefResolveFailure {
  ok: false
  code: 'ref-invalid' | 'ref-missing'
  message: string
}

export type ResolveRefResult = ResolvedRef | RefResolveFailure

/**
 * 在 schema 根中解析本地 `$ref`。仅允许 `#` 与 `#/$defs/<token>...`；
 * 第一个 token 必须为 `$defs`，否则视为非法引用形式。
 */
export function resolveRef(root: unknown, ref: string): ResolveRefResult {
  const parsed = parseRef(ref)
  if (!parsed.ok) return parsed
  const { tokens } = parsed
  if (tokens.length === 0) return { ok: true, value: root }
  if (tokens[0] !== '$defs') {
    return {
      ok: false,
      code: 'ref-invalid',
      message: `only local refs of the form "#" or "#/$defs/<token>" are supported (got "${ref}")`,
    }
  }
  let current: unknown = root
  for (const token of tokens) {
    if (typeof current !== 'object' || current === null) {
      return { ok: false, code: 'ref-missing', message: `ref target "${ref}" does not exist` }
    }
    if (!Object.hasOwn(current, token)) {
      return { ok: false, code: 'ref-missing', message: `ref target "${ref}" does not exist (missing "${token}")` }
    }
    current = (current as Record<string, unknown>)[token]
  }
  return { ok: true, value: current }
}
