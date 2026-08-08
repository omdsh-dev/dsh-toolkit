/**
 * 正则静态解释器 —— 轻量 tokenizer，把 pattern 拆成人读解释节点。
 *
 * 关键安全属性：**不构造 RegExp 实例、不执行匹配**——即使面对 (?=…)、嵌套量词等
 * 复杂结构也绝不会触发回溯，天然免疫 ReDoS。
 *
 * 识别规则（按顺序）：锚点 ^ $ → 字符类 [...]（含取反/范围）→ 分组 (…) (?:…) (?<name>…)
 * (?=…) (?!…) (?<=…) (?<!…) → 量词 * + ? {n} {n,} {n,m}（含 lazy 后缀）→ 转义类
 * \d \w \s \b 等 → 交替 | → 其余字面量。
 */

import { MAX_EXPLAIN_NODES, MAX_PATTERN_BYTES } from './engine.ts'

export interface ExplainNode {
  kind: 'literal' | 'class' | 'group' | 'quantifier' | 'anchor' | 'alternation' | 'escape'
  /** 原始切片（含定界符）。 */
  text: string
  /** 人读含义（英文）。 */
  meaning: string
}

const MAX_DISPLAY = 60

function truncate(s: string): string {
  return s.length > MAX_DISPLAY ? `${s.slice(0, MAX_DISPLAY)}…` : s
}

function escapeMeaning(esc: string): string {
  switch (esc) {
    case 'd': return 'A digit [0-9]'
    case 'D': return 'Not a digit'
    case 'w': return 'A word character [A-Za-z0-9_]'
    case 'W': return 'Not a word character'
    case 's': return 'A whitespace character'
    case 'S': return 'Not a whitespace character'
    case 'b': return 'Word boundary'
    case 'B': return 'Not a word boundary'
    case 'n': return 'Newline character'
    case 't': return 'Tab character'
    case 'r': return 'Carriage return'
    case 'f': return 'Form feed'
    case 'v': return 'Vertical tab'
    case '0': return 'NUL character'
    case 'x': return 'Hex escape (2 hex digits)'
    case 'u': return 'Unicode escape'
    case 'c': return 'Control character escape'
    case 'p': return 'Unicode property escape'
    case 'P': return 'Negated Unicode property escape'
    case 'k': return 'Named backreference'
    default: return `Escaped literal "${esc}"`
  }
}

/** 从 j 起扫描字符类，返回 ']' 下标（未闭合返回 -1）。 */
function scanClassEnd(pattern: string, j: number): number {
  while (j < pattern.length) {
    const c = pattern[j]!
    if (c === '\\') { j += 2; continue }
    if (c === ']') return j
    j++
  }
  return -1
}

/** 从 i（'(' 之后）扫描到匹配的 ')'：深度计数，跳过转义与字符类。 */
function scanParenEnd(pattern: string, i: number): number {
  let depth = 1
  let j = i
  while (j < pattern.length) {
    const c = pattern[j]!
    if (c === '\\') { j += 2; continue }
    if (c === '[') {
      const end = scanClassEnd(pattern, j + 1)
      if (end === -1) return -1
      j = end + 1
      continue
    }
    if (c === '(') depth++
    if (c === ')') {
      depth--
      if (depth === 0) return j
    }
    j++
  }
  return -1
}

/** 解析 pattern 为解释节点序列；结构性错误（未闭合括号/字符类）抛 regex: 错误。 */
export function explainPattern(pattern: unknown): ExplainNode[] {
  if (typeof pattern !== 'string') {
    throw new Error('regex: pattern must be a string')
  }
  if (Buffer.byteLength(pattern, 'utf8') > MAX_PATTERN_BYTES) {
    throw new Error(`regex: pattern exceeds ${MAX_PATTERN_BYTES} bytes`)
  }
  const nodes: ExplainNode[] = []
  let i = 0
  const len = pattern.length

  const push = (node: ExplainNode): void => {
    if (nodes.length >= MAX_EXPLAIN_NODES) {
      throw new Error(`regex: explain: pattern too complex (more than ${MAX_EXPLAIN_NODES} nodes)`)
    }
    nodes.push(node)
  }

  while (i < len) {
    const ch = pattern[i]!
    const pos = i

    // ── 转义 ──
    if (ch === '\\') {
      const esc = pattern[i + 1]
      if (esc === undefined) {
        push({ kind: 'escape', text: '\\', meaning: 'Lone backslash (trailing)' })
        break
      }
      let text = `\\${esc}`
      let meaning = escapeMeaning(esc)
      // \p{…} \P{…} \k<…>：吞掉属性/名字部分
      if ((esc === 'p' || esc === 'P' || esc === 'k') && pattern[i + 2] === '{') {
        let j = i + 3
        while (j < len && pattern[j] !== '}') j++
        if (j < len) {
          text = pattern.slice(i, j + 1)
          meaning = escapeMeaning(esc)
          i = j + 1
        } else {
          i += 2
        }
      } else {
        i += 2
      }
      push({ kind: 'escape', text, meaning })
      continue
    }

    // ── 字符类 ──
    if (ch === '[') {
      const end = scanClassEnd(pattern, i + 1)
      if (end === -1) {
        throw new Error(`regex: explain: unmatched "[" at position ${pos}`)
      }
      const inner = pattern.slice(i + 1, end)
      const negated = inner.startsWith('^')
      const display = truncate(negated ? inner.slice(1) : inner)
      push({
        kind: 'class',
        text: pattern.slice(i, end + 1),
        meaning: negated
          ? `Negated character class: matches any character NOT in [${display}]`
          : `Character class: matches one character from [${display}]`,
      })
      i = end + 1
      continue
    }

    // ── 分组 ──
    if (ch === '(') {
      let kind = 'Capturing group'
      let j = i + 1
      if (pattern[j] === '?') {
        const c2 = pattern[j + 1]
        if (c2 === ':') { kind = 'Non-capturing group'; j += 2 }
        else if (c2 === '=') { kind = 'Lookahead (positive assertion)'; j += 2 }
        else if (c2 === '!') { kind = 'Negative lookahead'; j += 2 }
        else if (c2 === '<') {
          const c3 = pattern[j + 2]
          if (c3 === '=') { kind = 'Lookbehind (positive assertion)'; j += 3 }
          else if (c3 === '!') { kind = 'Negative lookbehind'; j += 3 }
          else {
            // 命名组 (?<name>…)
            let name = ''
            let k = j + 2
            while (k < len && pattern[k] !== '>') { name += pattern[k]!; k++ }
            if (k >= len) {
              throw new Error(`regex: explain: unterminated named group at position ${pos}`)
            }
            kind = `Named capturing group "${name}"`
            j = k + 1
          }
        } else {
          kind = 'Group with special prefix (may be invalid in JS)'
          j += 1
        }
      }
      const end = scanParenEnd(pattern, j)
      if (end === -1) {
        throw new Error(`regex: explain: unmatched "(" at position ${pos}`)
      }
      push({ kind: 'group', text: pattern.slice(i, end + 1), meaning: kind })
      i = end + 1
      continue
    }

    // ── 未匹配的右括号 ──
    if (ch === ')') {
      throw new Error(`regex: explain: unmatched ")" at position ${pos}`)
    }

    // ── 量词 ──
    if (ch === '*' || ch === '+' || ch === '?') {
      let lazy = false
      let text = ch
      if (pattern[i + 1] === '?') { text += '?'; lazy = true; i++ }
      const base = ch === '*' ? '0 or more' : ch === '+' ? '1 or more' : '0 or 1'
      push({
        kind: 'quantifier',
        text,
        meaning: `Quantifier: previous item ${base} times (${lazy ? 'lazy' : 'greedy'})`,
      })
      i++
      continue
    }

    // ── {n} {n,} {n,m} 量词 ──
    if (ch === '{') {
      const m = /^\{(\d+)(,(\d*)?)?\}/.exec(pattern.slice(i))
      if (m) {
        let lazy = false
        let text = m[0]
        if (pattern[i + m[0].length] === '?') { text += '?'; lazy = true }
        const n = m[1]!
        const spec = m[2] === undefined
          ? `exactly ${n} times`
          : m[3] == null // V8: (\d*)? 空匹配为 null
            ? `${n} or more times`
            : `between ${n} and ${m[3]} times`
        push({
          kind: 'quantifier',
          text,
          meaning: `Quantifier: previous item ${spec} (${lazy ? 'lazy' : 'greedy'})`,
        })
        i += text.length
        continue
      }
      push({ kind: 'literal', text: '{', meaning: 'Literal "{"' })
      i++
      continue
    }

    // ── 锚点 / 交替 / 任意字符 ──
    if (ch === '^') {
      push({ kind: 'anchor', text: '^', meaning: 'Start anchor: matches at the beginning (with m flag, after any line break)' })
      i++
      continue
    }
    if (ch === '$') {
      push({ kind: 'anchor', text: '$', meaning: 'End anchor: matches at the end (with m flag, before any line break)' })
      i++
      continue
    }
    if (ch === '|') {
      push({ kind: 'alternation', text: '|', meaning: 'Alternation: match either the left or the right side' })
      i++
      continue
    }
    if (ch === '.') {
      push({ kind: 'literal', text: '.', meaning: 'Any character except line terminators' })
      i++
      continue
    }

    // ── 其余字面量 ──
    push({ kind: 'literal', text: ch, meaning: `Literal ${JSON.stringify(ch)}` })
    i++
  }

  return nodes
}
