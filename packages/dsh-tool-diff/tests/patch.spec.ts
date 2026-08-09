import { describe, expect, it } from 'vitest'
import { generatePatch, parsePatch, validatePatch } from '../src/patch.ts'

const BEFORE = 'line1\nline2\nline3\nline4\nline5\nline6\nline7'
const AFTER = 'line1\nline2\nchanged\nline4\nline5\nline6\nline7\nline8'

describe('generatePatch', () => {
  it('生成合法 unified diff 文本', () => {
    const { patch } = generatePatch('a.txt', 'b.txt', BEFORE, AFTER, 3)
    expect(patch).toContain('--- a.txt')
    expect(patch).toContain('+++ b.txt')
    expect(patch).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/)
    expect(patch).toContain('-line3')
    expect(patch).toContain('+changed')
    expect(patch).toContain('+line8')
  })

  it('多 hunk', () => {
    const b = 'aaa\nbbb\nccc\nddd\neee\nfff\nggg\nhhh\niii\njjj\nkkk\nlll\nmmm\nnnn\nooo\nppp\nqqq\nrrr\nsss\nttt'
    const a = 'aaa\nXXX\nccc\nddd\neee\nfff\nggg\nhhh\niii\njjj\nkkk\nlll\nmmm\nnnn\nooo\nppp\nYYY\nrrr\nsss\nttt'
    const { patch, ops } = generatePatch('x', 'y', b, a, 2)
    expect(patch.match(/@@/g)!.length).toBeGreaterThan(1)
    expect(ops.some(o => o.type === 'insert')).toBe(true)
  })

  it('相同文本 → 空 patch', () => {
    const { patch } = generatePatch('x', 'y', BEFORE, BEFORE, 3)
    expect(patch).toBe('')
  })
})

describe('validatePatch', () => {
  it('生成后应用结果等于 after', () => {
    const { patch } = generatePatch('before', 'after', BEFORE, AFTER, 3)
    const r = validatePatch(BEFORE, patch, AFTER)
    expect(r.valid).toBe(true)
    expect(r.targetMatchesAfter).toBe(true)
    expect(r.hunks).toBeGreaterThan(0)
    expect(r.errors).toEqual([])
  })

  it('多 hunk 校验', () => {
    const b = 'aaa\nbbb\nccc\nddd\neee\nfff\nggg\nhhh\niii\njjj\nkkk\nlll\nmmm\nnnn\nooo\nppp\nqqq\nrrr\nsss\nttt'
    const a = 'aaa\nXXX\nccc\nddd\neee\nfff\nggg\nhhh\niii\njjj\nkkk\nlll\nmmm\nnnn\nooo\nppp\nYYY\nrrr\nsss\nttt'
    const { patch } = generatePatch('x', 'y', b, a, 2)
    const r = validatePatch(b, patch, a)
    expect(r.valid).toBe(true)
    expect(r.hunks).toBeGreaterThan(1)
  })

  it('上下文不匹配 → invalid', () => {
    const { patch } = generatePatch('x', 'y', BEFORE, AFTER, 3)
    const tampered = patch.replace(' line2', ' WRONG')
    const r = validatePatch(BEFORE, tampered, AFTER)
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('mismatch'))).toBe(true)
  })

  it('删除行不匹配 → invalid', () => {
    const { patch } = generatePatch('x', 'y', BEFORE, AFTER, 3)
    const tampered = patch.replace('-line3', '-lineX')
    const r = validatePatch(BEFORE, tampered, AFTER)
    expect(r.valid).toBe(false)
  })

  it('行号错误 → invalid（oldStart 越界或间隙不一致）', () => {
    const { patch } = generatePatch('x', 'y', BEFORE, AFTER, 3)
    const tampered = patch.replace('@@ -1,7 +1,8 @@', '@@ -99,7 +1,8 @@')
    const r = validatePatch(BEFORE, tampered, AFTER)
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('gap mismatch') || e.includes('out of bounds'))).toBe(true)
  })

  it('篡改 newStart → invalid（D-02）', () => {
    const { patch } = generatePatch('x', 'y', 'a\nb', 'a\nX', 3)
    const tampered = patch.replace('@@ -1,2 +1,2 @@', '@@ -1,2 +99,2 @@')
    const r = validatePatch('a\nb', tampered, 'a\nX')
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('gap mismatch'))).toBe(true)
  })

  it('多 hunk 顺序颠倒 / 重叠 → invalid（D-09）', () => {
    const b = 'aaa\nbbb\nccc\nddd\neee\nfff\nggg\nhhh\niii\njjj\nkkk\nlll\nmmm\nnnn\nooo\nppp\nqqq\nrrr\nsss\nttt'
    const a = 'aaa\nXXX\nccc\nddd\neee\nfff\nggg\nhhh\niii\njjj\nkkk\nlll\nmmm\nnnn\nooo\nppp\nYYY\nrrr\nsss\nttt'
    const { patch } = generatePatch('x', 'y', b, a, 2)
    const lines = patch.split('\n')
    const h1 = lines.findIndex(l => l.startsWith('@@ -1'))
    const h2 = lines.findIndex(l => l.startsWith('@@ -15'))
    // 交换两个 hunk 头（顺序颠倒）
    const swapped = [...lines]
    ;[swapped[h1], swapped[h2]] = [swapped[h2]!, swapped[h1]!]
    const r = validatePatch(b, swapped.join('\n'), a)
    expect(r.valid).toBe(false)
    // 重叠：把第二个 hunk 的 oldStart 改小到第一个 hunk 内
    const overlapped = patch.replace('@@ -15,5 +15,5 @@', '@@ -2,5 +2,5 @@')
    const r2 = validatePatch(b, overlapped, a)
    expect(r2.valid).toBe(false)
  })

  it('无末尾换行的 patch 可校验', () => {
    const before = 'a\nb'
    const after = 'a\nb\nc'
    const { patch } = generatePatch('x', 'y', before, after, 3)
    expect(patch).toContain('\\ No newline at end of file')
    const r = validatePatch(before, patch, after)
    expect(r.valid).toBe(true)
  })

  it('空 hunk 列表 → invalid', () => {
    const r = validatePatch(BEFORE, '--- x\n+++ y\n', AFTER)
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('no hunks'))).toBe(true)
  })

  it('空文件 → 有内容（@@ -0,0）的 patch 可校验', () => {
    const { patch } = generatePatch('x', 'y', '', 'x\ny', 3)
    expect(patch).toContain('@@ -0,0 +1,2 @@')
    const r = validatePatch('', patch, 'x\ny')
    expect(r.valid).toBe(true)
    expect(r.targetMatchesAfter).toBe(true)
  })

  it('仅末尾换行差异生成非空 patch 且校验通过', () => {
    const { patch } = generatePatch('x', 'y', 'a', 'a\n', 3)
    expect(patch).not.toBe('')
    const r = validatePatch('a', patch, 'a\n')
    expect(r.valid).toBe(true)
  })

  it('缺少文件头：strict 拒绝，lenient 容忍（D-14）', () => {
    const { patch } = generatePatch('x', 'y', 'a\nb', 'a\nc', 3)
    const headerless = patch.split('\n').slice(2).join('\n')
    const strict = parsePatch(headerless)
    expect(strict.errors.some(e => e.includes('file headers'))).toBe(true)
    const lenient = parsePatch(headerless, { strict: false })
    expect(lenient.hunks.length).toBeGreaterThan(0)
    expect(lenient.errors).toEqual([])
  })

  it('strict 模式拒绝非法 hunk 正文行（D-14）', () => {
    const { patch } = generatePatch('x', 'y', 'a\nb', 'a\nc', 3)
    const bad = patch.replace(' a\n-b', ' a\nbogus-line\n-b')
    const r = parsePatch(bad)
    expect(r.errors.some(e => e.includes('invalid hunk body line'))).toBe(true)
    // 行数与 header 计数不一致
    const badCounts = patch.replace('@@ -1,2 +1,2 @@', '@@ -1,2 +1,3 @@')
    const r2 = parsePatch(badCounts)
    expect(r2.errors.some(e => e.includes('expected 2/3 lines'))).toBe(true)
  })

  it('大规模多变更 patch 生成与校验', () => {
    const bigBefore = Array.from({ length: 3000 }, (_, i) => `line${i}`).join('\n')
    // 每 10 行改一行 → 300 处变更，patch 体量可观
    const bigAfter = bigBefore.split('\n').map((l, i) => (i % 10 === 5 ? l + '!changed' : l)).join('\n')
    const { patch } = generatePatch('x', 'y', bigBefore, bigAfter, 1)
    expect(patch.length).toBeGreaterThan(1000)
    const r = validatePatch(bigBefore, patch, bigAfter)
    expect(r.valid).toBe(true)
    expect(r.targetMatchesAfter).toBe(true)
  })
})
