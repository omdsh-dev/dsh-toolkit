/**
 * unified patch 生成与内存校验。
 *
 * - generatePatch：复用 text-diff 的 unified 渲染，可自定义文件标签（默认 before/after）；
 * - validatePatch：解析 `---`/`+++`/`@@`/上下文行，在内存中把补丁应用到 before，
 *   与 after 逐行比对；绝不写文件、不调用 git（read-only）。
 */

import { splitLines, diffLines, renderUnified, type Line, type DiffOp } from './text-diff.ts'
import { assertInputSize } from './limits.ts'

export interface PatchValidationResult {
  valid: boolean
  hunks: number
  appliedLines: number
  targetMatchesAfter: boolean
  errors: string[]
}

export function generatePatch(
  beforeLabel: string,
  afterLabel: string,
  beforeText: string,
  afterText: string,
  context: number,
  options: { ignoreWhitespace?: boolean; ignoreCase?: boolean } = {},
): { patch: string; ops: DiffOp[] } {
  assertInputSize(beforeText, 'before')
  assertInputSize(afterText, 'after')
  const a = splitLines(beforeText)
  const b = splitLines(afterText)
  const ops = diffLines(a.lines, b.lines, options)
  const patch = renderUnified(beforeLabel, afterLabel, a.lines, b.lines, ops, context, a.trailingNewline, b.trailingNewline)
  return { patch, ops }
}

interface ParsedHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  /** 每个元素: { kind: 'ctx'|'del'|'add', text } */
  lines: Array<{ kind: 'ctx' | 'del' | 'add'; text: string }>
}

/**
 * 解析 unified diff 文本。容忍缺失文件头（允许只含 @@ hunks）。
 * 忽略 `\ No newline at end of file` 标记行（行级校验不依赖字节末尾）。
 */
export function parsePatch(patchText: string): { hunks: ParsedHunk[]; errors: string[] } {
  const errors: string[] = []
  const hunks: ParsedHunk[] = []
  const lines = patchText.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  // 跳过文件头（--- / +++ / diff --git 等）
  while (i < lines.length) {
    const l = lines[i]!
    if (l.startsWith('@@')) break
    if (l.startsWith('---') || l.startsWith('+++') || l.startsWith('diff ') || l.startsWith('index ') || l.startsWith('new file') || l.startsWith('deleted file') || l.startsWith('similarity') || l.startsWith('rename ')) { i++; continue }
    if (l.trim() === '') { i++; continue }
    break
  }
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
  while (i < lines.length) {
    const l = lines[i]!
    if (l.trim() === '') { i++; continue }
    if (l.startsWith('\\ No newline')) { i++; continue }
    const m = hunkRe.exec(l)
    if (!m) {
      if (l.startsWith('---') || l.startsWith('+++') || l.startsWith('diff ') || l.startsWith('index ')) { i++; continue }
      errors.push(`unexpected line at ${i + 1}: ${l.slice(0, 60)}`)
      return { hunks, errors }
    }
    const oldStart = Number(m[1])
    const oldCount = m[2] === undefined ? 1 : Number(m[2])
    const newStart = Number(m[3])
    const newCount = m[4] === undefined ? 1 : Number(m[4])
    const h: ParsedHunk = { oldStart, oldCount, newStart, newCount, lines: [] }
    i++
    let seenOld = 0
    let seenNew = 0
    while (i < lines.length && (seenOld < oldCount || seenNew < newCount)) {
      const cl = lines[i]!
      if (cl.startsWith('\\ No newline')) { i++; continue }
      if (cl.startsWith('@@')) {
        errors.push('hunk ended early (unexpected @@)')
        break
      }
      const kind = cl.startsWith('-') ? 'del' : cl.startsWith('+') ? 'add' : 'ctx'
      if (kind === 'ctx' || kind === 'del') seenOld++
      if (kind === 'ctx' || kind === 'add') seenNew++
      h.lines.push({ kind, text: cl.slice(1) })
      i++
    }
    if (seenOld !== oldCount || seenNew !== newCount) {
      errors.push(`hunk @@ -${oldStart},${oldCount} +${newStart},${newCount} @@: expected ${oldCount}/${newCount} lines, saw ${seenOld}/${seenNew}`)
    }
    hunks.push(h)
  }
  return { hunks, errors }
}

/**
 * 内存中应用补丁并校验：把 hunks 应用到 before 行数组，
 * 若所有上下文/删除行匹配且结果与 after 逐行一致 → 补丁有效。
 */
export function validatePatch(beforeText: string, patchText: string, afterText: string): PatchValidationResult {
  const errors: string[] = []
  const before = beforeText.replace(/\r\n/g, '\n').split('\n')
  const after = afterText.replace(/\r\n/g, '\n').split('\n')
  // 去掉 split 末尾空元素（trailing newline 与行级比较无关）
  if (before.length > 0 && before[before.length - 1] === '') before.pop()
  if (after.length > 0 && after[after.length - 1] === '') after.pop()

  // 空补丁：两边行级相等 → 平凡有效；不等 → 明确报错
  if (patchText.trim() === '') {
    const equal = before.length === after.length && before.every((l, i) => l === after[i])
    return {
      valid: equal,
      hunks: 0,
      appliedLines: 0,
      targetMatchesAfter: equal,
      errors: equal ? [] : ['patch is empty but before does not match after'],
    }
  }

  const parsed = parsePatch(patchText)
  errors.push(...parsed.errors)
  if (parsed.hunks.length === 0 && !errors.length) {
    errors.push('patch contains no hunks')
  }

  const applied = before.slice()
  let appliedLines = 0
  let shift = 0
  for (const h of parsed.hunks) {
    const pos = h.oldStart - 1 + shift
    if (pos < 0 || pos > applied.length) {
      errors.push(`hunk @@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@: position ${pos} out of bounds (file has ${applied.length} lines)`)
      continue
    }
    // 校验 ctx/del 行
    let di = pos
    let ok = true
    for (const pl of h.lines) {
      if (pl.kind === 'add') continue
      const target = applied[di]
      if (target === undefined || target !== pl.text) {
        errors.push(`hunk @@ -${h.oldStart},... : context line ${di + 1} mismatch (expected ${JSON.stringify(pl.text)}, got ${JSON.stringify(target)})`)
        ok = false
        break
      }
      di++
    }
    if (!ok) continue
    // 应用：删除 del，插入 add
    let di2 = pos
    for (const pl of h.lines) {
      if (pl.kind === 'del') { applied.splice(di2, 1); appliedLines++ }
      else if (pl.kind === 'add') { applied.splice(di2, 0, pl.text); di2++; appliedLines++ }
      else di2++
    }
    shift += (h.newCount - h.oldCount)
  }

  let targetMatchesAfter = applied.length === after.length && applied.every((l, i) => l === after[i])
  if (!targetMatchesAfter) {
    errors.push('patched result does not match after content')
  }
  return { valid: errors.length === 0, hunks: parsed.hunks.length, appliedLines, targetMatchesAfter, errors }
}
