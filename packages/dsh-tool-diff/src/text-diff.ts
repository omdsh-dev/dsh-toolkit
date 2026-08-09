/**
 * 行级 Myers diff 与 unified diff 渲染 —— 零依赖，纯函数。
 *
 * - 输入按 \n 分行（CRLF 先归一为 LF），保留末尾换行信息；
 * - Myers O(ND) 迭代实现（非递归，避免大输入调用栈增长）；
 * - 高度差异输入设置 diagonal 预算：超限回退"全删全增"表示（结果仍正确，只是非最小）；
 * - unified diff 渲染：`--- before` / `+++ after` / `@@ -s,c +s,c @@`，
 *   无时间戳（可复现）；末尾无换行输出 `\ No newline at end of file`。
 */

import { MAX_LINES } from './limits.ts'

export interface Line {
  text: string
  hash: number
}

export interface DiffOp {
  type: 'equal' | 'insert' | 'delete'
  text: string
}

export interface DiffOptions {
  ignoreWhitespace?: boolean
  ignoreCase?: boolean
}

/** 行 hash（djb2）。 */
function hashLine(text: string): number {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return h
}

/** 归一化（按选项）后比较两行是否相等。 */
function lineEqual(a: Line, b: Line, options: DiffOptions): boolean {
  if (a.hash === b.hash && a.text === b.text) return true
  return normKey(a.text, options) === normKey(b.text, options)
}

/** 按选项归一化的比较键（D-06 修复：快速拒绝与 lineEqual 使用同一等价关系）。 */
function normKey(text: string, options: DiffOptions): string {
  let t = text
  if (options.ignoreCase) t = t.toLowerCase()
  if (options.ignoreWhitespace) t = t.replace(/[ \t\r\n\f]+/g, ' ').trim()
  return t
}

/** 把文本拆成带 hash 的行（保留末尾换行信息）。空文本：无行、无末尾换行。 */
export function splitLines(text: string): { lines: Line[]; trailingNewline: boolean } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (normalized === '') return { lines: [], trailingNewline: false }
  const parts = normalized.split('\n')
  let trailingNewline = false
  if (parts.length > 0 && parts[parts.length - 1] === '') {
    trailingNewline = true
    parts.pop()
  }
  return { lines: parts.map(t => ({ text: t, hash: hashLine(t) })), trailingNewline }
}

const MAX_D = 2000
/** 修剪公共前后缀后，剩余行数总和超过该值 → 直接回退全删全增（控制 trace 内存）。 */
const NP_MP_MAX = 4000

/**
 * Myers 行级 diff。
 * 返回操作序列；D 超预算或规模超限时回退"全删全增"（结果正确、非最小）。
 *
 * 复杂度防线（恶意重复/全异文本）：
 * 1. 公共前缀/后缀修剪（O(n+m)）；
 * 2. hash 快速拒绝：剩余两侧无公共行 → 立即回退，不进入 Myers；
 * 3. 剩余规模 np+mp > 4000 → 回退（trace 内存上限 ≈ 2001×8001×4B ≈ 64MB）；
 * 4. diagonal 预算 MAX_D=2000 超限 → 回退。
 */
export function diffLines(before: Line[], after: Line[], options: DiffOptions = {}): DiffOp[] {
  const n = before.length
  const m = after.length
  if (n > MAX_LINES || m > MAX_LINES) {
    throw new Error(`diff: input exceeds ${MAX_LINES} lines`)
  }
  if (n === 0) return after.map(l => ({ type: 'insert' as const, text: l.text }))
  if (m === 0) return before.map(l => ({ type: 'delete' as const, text: l.text }))

  // 1. 公共前缀
  let pre = 0
  while (pre < n && pre < m && lineEqual(before[pre]!, after[pre]!, options)) pre++
  // 2. 公共后缀
  let suf = 0
  while (suf < n - pre && suf < m - pre && lineEqual(before[n - 1 - suf]!, after[m - 1 - suf]!, options)) suf++
  const np = n - pre - suf
  const mp = m - pre - suf

  let middle: DiffOp[] = []
  if (np === 0 && mp === 0) {
    middle = []
  } else if (np === 0) {
    middle = after.slice(pre, m - suf).map(l => ({ type: 'insert' as const, text: l.text }))
  } else if (mp === 0) {
    middle = before.slice(pre, n - suf).map(l => ({ type: 'delete' as const, text: l.text }))
  } else if (np + mp > NP_MP_MAX) {
    // 规模超限：回退
    middle = [
      ...before.slice(pre, n - suf).map(l => ({ type: 'delete' as const, text: l.text })),
      ...after.slice(pre, m - suf).map(l => ({ type: 'insert' as const, text: l.text })),
    ]
  } else {
    // 快速拒绝：剩余两侧无公共行（按与 lineEqual 相同的归一化键）→ 回退。
    // D-06 修复：ignore 选项下使用归一化键而非原始 hash，避免漏判归一化后相等的公共行。
    const set = new Set<string>()
    for (let i = 0; i < mp; i++) set.add(normKey(after[pre + i]!.text, options))
    let common = false
    for (let i = 0; i < np; i++) {
      if (set.has(normKey(before[pre + i]!.text, options))) { common = true; break }
    }
    if (!common) {
      middle = [
        ...before.slice(pre, n - suf).map(l => ({ type: 'delete' as const, text: l.text })),
        ...after.slice(pre, m - suf).map(l => ({ type: 'insert' as const, text: l.text })),
      ]
    } else {
      middle = myersCore(before.slice(pre, n - suf), after.slice(pre, m - suf), options)
    }
  }

  const ops: DiffOp[] = []
  for (let i = 0; i < pre; i++) ops.push({ type: 'equal', text: before[i]!.text })
  ops.push(...middle)
  for (let i = n - suf; i < n; i++) ops.push({ type: 'equal', text: before[i]!.text })
  return ops
}

/** 修剪后的 Myers 核心（np/mp 已受 NP_MP_MAX 约束）。 */
function myersCore(before: Line[], after: Line[], options: DiffOptions): DiffOp[] {
  const n = before.length
  const m = after.length
  const max = n + m
  const offset = max
  const v = new Int32Array(2 * max + 1)
  const trace: Int32Array[] = []
  let found = false
  let dFound = 0
  // 蛇步总预算：对抗性输入（大量相同行错位）下保证运行时间有界
  const SNAKE_BUDGET = 20_000_000
  let snakeSteps = 0

  outer: for (let d = 0; d <= MAX_D; d++) {
    trace.push(v.slice())
    for (let k = -d; k <= d; k += 2) {
      const idx = k + offset
      let x: number
      if (k === -d || (k !== d && v[idx - 1]! < v[idx + 1]!)) {
        x = v[idx + 1]! // 向下
      } else {
        x = v[idx - 1]! + 1 // 向右
      }
      let y = x - k
      while (x < n && y < m && lineEqual(before[x]!, after[y]!, options)) {
        x++; y++
        if (++snakeSteps > SNAKE_BUDGET) break outer
      }
      v[idx] = x
      if (x >= n && y >= m) { found = true; dFound = d; break outer }
    }
  }

  if (!found) {
    // diagonal 预算超限：回退全删全增
    return [
      ...before.map(l => ({ type: 'delete' as const, text: l.text })),
      ...after.map(l => ({ type: 'insert' as const, text: l.text })),
    ]
  }

  // 回溯 trace 构建操作序列
  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let d = dFound; d > 0; d--) {
    const vPrev = trace[d]!
    const k = x - y
    const idx = k + offset
    let prevK: number
    if (k === -d || (k !== d && vPrev[idx - 1]! < vPrev[idx + 1]!)) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = vPrev[prevK + offset]!
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ type: 'equal', text: before[x - 1]!.text })
      x--; y--
    }
    if (x === prevX) {
      ops.push({ type: 'insert', text: after[y - 1]!.text })
      y--
    } else {
      ops.push({ type: 'delete', text: before[x - 1]!.text })
      x--
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ type: 'equal', text: before[x - 1]!.text })
    x--; y--
  }
  while (x > 0) { ops.push({ type: 'delete', text: before[x - 1]!.text }); x-- }
  while (y > 0) { ops.push({ type: 'insert', text: after[y - 1]!.text }); y-- }
  ops.reverse()
  return ops
}

export function lineStats(ops: DiffOp[]): { addedLines: number; removedLines: number; unchangedLines: number } {
  let addedLines = 0
  let removedLines = 0
  let unchangedLines = 0
  for (const op of ops) {
    if (op.type === 'insert') addedLines++
    else if (op.type === 'delete') removedLines++
    else unchangedLines++
  }
  return { addedLines, removedLines, unchangedLines }
}

/**
 * 实际渲染用的 op 序列：仅末尾换行差异（行级全 equal 但字节不同）时，
 * 把最后一行（或空文件占位）合成 delete+insert，使 diff 文本、stats、equal 三者同源。
 */
export function effectiveOps(ops: DiffOp[], beforeTrailing: boolean, afterTrailing: boolean): DiffOp[] {
  if (ops.every(o => o.type === 'equal') && beforeTrailing !== afterTrailing) {
    if (ops.length > 0) {
      const last = ops[ops.length - 1]!
      return [...ops.slice(0, -1), { type: 'delete', text: last.text }, { type: 'insert', text: last.text }]
    }
    return [{ type: 'delete', text: '' }, { type: 'insert', text: '' }]
  }
  return ops
}

/** 渲染 unified diff（无时间戳，可复现，GNU 标记位置语义）。 */
export function renderUnified(
  beforeLabel: string,
  afterLabel: string,
  before: Line[],
  after: Line[],
  ops: DiffOp[],
  context: number,
  beforeTrailing: boolean,
  afterTrailing: boolean,
): string {
  if (ops.every(o => o.type === 'equal') && beforeTrailing === afterTrailing) return ''
  const work = effectiveOps(ops, beforeTrailing, afterTrailing)
  const out: string[] = [`--- ${beforeLabel}`, `+++ ${afterLabel}`]

  // 两侧最后一行在 op 序列中的下标（\ No newline 标记紧跟其后）
  let lastBeforeIdx = -1
  let lastAfterIdx = -1
  work.forEach((o, i) => {
    if (o.type !== 'insert') lastBeforeIdx = i
    if (o.type !== 'delete') lastAfterIdx = i
  })

  // 按 context 合并 hunk
  const changeIdx: number[] = []
  work.forEach((o, i) => { if (o.type !== 'equal') changeIdx.push(i) })
  const hunks: Array<{ start: number; end: number }> = []
  for (const i of changeIdx) {
    const start = Math.max(0, i - context)
    const end = Math.min(work.length - 1, i + context)
    if (hunks.length > 0 && start <= hunks[hunks.length - 1]!.end + 1) {
      hunks[hunks.length - 1]!.end = end
    } else {
      hunks.push({ start, end })
    }
  }

  for (const hunk of hunks) {
    // 行号：计算 hunk 起点对应的 old/new 位置（空文件起始行号为 0）
    let oldLine = 1
    let newLine = 1
    for (let i = 0; i < hunk.start; i++) {
      const t = work[i]!.type
      if (t !== 'insert') oldLine++
      if (t !== 'delete') newLine++
    }
    if (before.length === 0) oldLine = 0
    if (after.length === 0) newLine = 0
    let oldCount = 0
    let newCount = 0
    for (let i = hunk.start; i <= hunk.end; i++) {
      const t = work[i]!.type
      if (t !== 'insert') oldCount++
      if (t !== 'delete') newCount++
    }
    out.push(`@@ -${oldLine},${oldCount} +${newLine},${newCount} @@`)
    for (let i = hunk.start; i <= hunk.end; i++) {
      const o = work[i]!
      if (o.type === 'equal') out.push(` ${o.text}`)
      else if (o.type === 'delete') out.push(`-${o.text}`)
      else out.push(`+${o.text}`)
      if (i === lastBeforeIdx && !beforeTrailing && before.length > 0) {
        out.push('\\ No newline at end of file')
      }
      if (i === lastAfterIdx && !afterTrailing && after.length > 0) {
        out.push('\\ No newline at end of file')
      }
    }
  }

  return out.join('\n') + '\n'
}

/** 便捷入口：两段文本 → unified diff 文本（空串表示相等）。 */
export function unifiedDiff(
  beforeText: string,
  afterText: string,
  options: { context?: number; ignoreWhitespace?: boolean; ignoreCase?: boolean } = {},
): { diff: string; ops: DiffOp[]; stats: { addedLines: number; removedLines: number; unchangedLines: number } } {
  const context = options.context ?? 3
  const a = splitLines(beforeText)
  const b = splitLines(afterText)
  const ops = diffLines(a.lines, b.lines, options)
  // stats 与渲染同源：仅末尾换行差异时按合成后的 delete+insert 计
  const stats = lineStats(effectiveOps(ops, a.trailingNewline, b.trailingNewline))
  const diff = renderUnified('before', 'after', a.lines, b.lines, ops, context, a.trailingNewline, b.trailingNewline)
  return { diff, ops, stats }
}
