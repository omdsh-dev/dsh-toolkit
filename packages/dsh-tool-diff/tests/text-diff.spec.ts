import { describe, expect, it } from 'vitest'
import { splitLines, diffLines, lineStats, unifiedDiff, renderUnified } from '../src/text-diff.ts'

describe('splitLines', () => {
  it('两个空字符串', () => {
    const a = splitLines('')
    expect(a.lines).toEqual([])
    expect(a.trailingNewline).toBe(false)
  })

  it('CRLF 与 LF 统一为 LF', () => {
    const a = splitLines('a\r\nb\r\n')
    expect(a.lines.map(l => l.text)).toEqual(['a', 'b'])
    expect(a.trailingNewline).toBe(true)
    const b = splitLines('a\nb\n')
    expect(b.lines.map(l => l.text)).toEqual(['a', 'b'])
  })

  it('无末尾换行', () => {
    const a = splitLines('a\nb')
    expect(a.trailingNewline).toBe(false)
  })
})

describe('diffLines: Myers 行级 diff', () => {
  it('完全相同文本 → 全部 equal', () => {
    const a = splitLines('a\nb\nc')
    const ops = diffLines(a.lines, a.lines)
    expect(ops.every(o => o.type === 'equal')).toBe(true)
    expect(ops).toHaveLength(3)
  })

  it('单行新增', () => {
    const a = splitLines('a\nc')
    const b = splitLines('a\nb\nc')
    const ops = diffLines(a.lines, b.lines)
    const stats = lineStats(ops)
    expect(stats.addedLines).toBe(1)
    expect(stats.removedLines).toBe(0)
    const ins = ops.find(o => o.type === 'insert')
    expect(ins?.text).toBe('b')
  })

  it('单行删除', () => {
    const a = splitLines('a\nb\nc')
    const b = splitLines('a\nc')
    const ops = diffLines(a.lines, b.lines)
    const stats = lineStats(ops)
    expect(stats.removedLines).toBe(1)
    const del = ops.find(o => o.type === 'delete')
    expect(del?.text).toBe('b')
  })

  it('中间插入，上下文行正确', () => {
    const a = splitLines('1\n2\n3\n4\n5')
    const b = splitLines('1\n2\nX\n3\n4\n5')
    const ops = diffLines(a.lines, b.lines)
    const stats = lineStats(ops)
    expect(stats.addedLines).toBe(1)
    // 插入位置在 2 之后
    const idx = ops.findIndex(o => o.type === 'insert')
    expect(ops[idx - 1]?.type).toBe('equal')
    expect(ops[idx - 1]?.text).toBe('2')
  })

  it('多个不相邻 hunk 不错误合并', () => {
    const a = splitLines('a1\na2\na3\na4\na5\na6\na7\na8\na9\na10')
    const b = splitLines('a1\nX\na3\na4\na5\na6\na7\na8\nY\na10')
    const ops = diffLines(a.lines, b.lines)
    const stats = lineStats(ops)
    expect(stats.addedLines).toBe(2)
    expect(stats.removedLines).toBe(2)
  })

  it('大量重复行在预算内完成（不超时）', () => {
    const a = splitLines(Array.from({ length: 20000 }, () => 'same').join('\n'))
    const b = splitLines(Array.from({ length: 20000 }, () => 'same').join('\n') + '\ndiff')
    const t0 = Date.now()
    const ops = diffLines(a.lines, b.lines)
    const stats = lineStats(ops)
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(stats.addedLines).toBe(1)
  })

  it('高度差异输入回退全删全增（预算内完成）', () => {
    // 50K 行全部不同：diagonal 预算超限 → 回退
    const n = 3000
    const a = splitLines(Array.from({ length: n }, (_, i) => `old${i}`).join('\n'))
    const b = splitLines(Array.from({ length: n }, (_, i) => `new${i}`).join('\n'))
    const t0 = Date.now()
    const ops = diffLines(a.lines, b.lines)
    expect(Date.now() - t0).toBeLessThan(3000)
    const stats = lineStats(ops)
    expect(stats.removedLines).toBe(n)
    expect(stats.addedLines).toBe(n)
  })

  it('ignoreCase / ignoreWhitespace 生效', () => {
    const a = splitLines('Hello World')
    const b = splitLines('hello   world')
    const ops1 = diffLines(a.lines, b.lines)
    expect(lineStats(ops1).addedLines).toBe(1)
    const ops2 = diffLines(a.lines, b.lines, { ignoreCase: true, ignoreWhitespace: true })
    expect(ops2.every(o => o.type === 'equal')).toBe(true)
  })
})

describe('renderUnified', () => {
  it('相等文本输出空串', () => {
    const a = splitLines('x')
    const d = renderUnified('before', 'after', a.lines, a.lines, diffLines(a.lines, a.lines), 3, false, false)
    expect(d).toBe('')
  })

  it('无末尾换行输出 no-newline 标记', () => {
    const a = splitLines('a\nb')
    const b = splitLines('a\nb\nc')
    const ops = diffLines(a.lines, b.lines)
    const d = renderUnified('before', 'after', a.lines, b.lines, ops, 3, a.trailingNewline, b.trailingNewline)
    expect(d).toContain('\\ No newline at end of file')
  })

  it('context=0 只输出变更行', () => {
    const a = splitLines('1\n2\n3\n4\n5')
    const b = splitLines('1\n2\nX\n4\n5')
    const ops = diffLines(a.lines, b.lines)
    const d = renderUnified('before', 'after', a.lines, b.lines, ops, 0, false, false)
    expect(d).toContain('@@ -3,1 +3,1 @@')
    expect(d).toContain('-3')
    expect(d).toContain('+X')
    // 无上下文行
    const body = d.split('\n').slice(2)
    expect(body.some(l => l.startsWith(' '))).toBe(false)
  })

  it('unifiedDiff 便捷入口返回统计', () => {
    const r = unifiedDiff('a\nb', 'a\nb\nc')
    expect(r.stats.addedLines).toBe(1)
    expect(r.diff).toContain('--- before')
    expect(r.diff).toContain('+++ after')
    expect(r.diff).toContain('+c')
  })

  it('仅末尾换行差异不算相等（a vs a\\n），stats 与 diff 同源', () => {
    const r = unifiedDiff('a', 'a\n')
    expect(r.diff).not.toBe('')
    expect(r.diff).toContain('-a')
    expect(r.diff).toContain('\\ No newline at end of file')
    expect(r.stats.addedLines).toBe(1)
    expect(r.stats.removedLines).toBe(1)
    expect(r.stats.unchangedLines).toBe(0)
  })

  it('空 vs 空行：仅插入 1 行', () => {
    const r = unifiedDiff('', '\n')
    expect(r.stats.addedLines).toBe(1)
    expect(r.stats.removedLines).toBe(0)
  })

  it('\\ No newline 标记紧跟两侧最后一行（GNU 位置语义）', () => {
    // 删除行场景：before 最后一行 -b 后紧跟 before 标记
    const r = unifiedDiff('a\nb', 'a\nX')
    const lines = r.diff.split('\n')
    const bIdx = lines.indexOf('-b')
    expect(bIdx).toBeGreaterThan(0)
    expect(lines[bIdx + 1]).toBe('\\ No newline at end of file')
    // 上下文行场景：before 最后一行是上下文 ' b'，标记跟其后
    const r2 = unifiedDiff('a\nb', 'a\nb\nc')
    const lines2 = r2.diff.split('\n')
    const ctxIdx = lines2.indexOf(' b')
    expect(lines2[ctxIdx + 1]).toBe('\\ No newline at end of file')
    // after 侧最后一行 +c 后紧跟 after 标记
    const cIdx = lines2.indexOf('+c')
    expect(lines2[cIdx + 1]).toBe('\\ No newline at end of file')
  })

  it('空文件起始行号为 0（@@ -0,0）', () => {
    const r = unifiedDiff('', 'x\ny')
    expect(r.diff).toContain('@@ -0,0 +1,2 @@')
  })
})
