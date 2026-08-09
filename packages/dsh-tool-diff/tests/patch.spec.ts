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

  it('行号错误 → invalid', () => {
    const { patch } = generatePatch('x', 'y', BEFORE, AFTER, 3)
    const tampered = patch.replace('@@ -1,7 +1,8 @@', '@@ -99,7 +1,8 @@')
    const r = validatePatch(BEFORE, tampered, AFTER)
    expect(r.valid).toBe(false)
    expect(r.errors.some(e => e.includes('out of bounds'))).toBe(true)
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

  it('缺少文件头仍可解析（容忍）', () => {
    const { patch } = generatePatch('x', 'y', 'a\nb', 'a\nc', 3)
    const headerless = patch.split('\n').slice(2).join('\n')
    const parsed = parsePatch(headerless)
    expect(parsed.hunks.length).toBeGreaterThan(0)
    expect(parsed.errors).toEqual([])
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
