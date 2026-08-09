import { describe, expect, it } from 'vitest'
import * as plugin from '../src/index.ts'
import { diffLines, splitLines, unifiedDiff } from '../src/text-diff.ts'
import { markdownDiff } from '../src/markdown-diff.ts'
import { csvDiff } from '../src/csv-diff.ts'
import { scanDuplicateKeys, jsonDiffText } from '../src/json-diff.ts'
import { assertWellFormedText, MAX_OUTPUT_BYTES, utf8ByteLength } from '../src/limits.ts'

/** 经工具管道执行（defineTool execute + 参数校验）。 */
async function toolCall(args: Record<string, unknown>): Promise<{ text: string } | { error: string }> {
  let tool: { execute: (a: unknown) => Promise<unknown> } | undefined
  const fakeCtx = {
    tools: { register(t: { execute: (a: unknown) => Promise<unknown> }) { tool = t } },
  }
  plugin.apply(fakeCtx as never)
  try {
    const value = await tool!.execute(args)
    return { text: value as string }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

describe('审查修复 D-01: patch.equal 语义', () => {
  it('a -> b：equal:false、valid:true、changes>0', async () => {
    const r = await toolCall({ action: 'patch', before: 'a', after: 'b' })
    const j = JSON.parse((r as { text: string }).text)
    expect(j.equal).toBe(false)
    expect(j.valid).toBe(true)
    expect(j.changes).toBeGreaterThan(0)
  })

  it('相等输入：equal:true 且 changes:0', async () => {
    const r = await toolCall({ action: 'patch', before: 'a\nb', after: 'a\nb' })
    const j = JSON.parse((r as { text: string }).text)
    expect(j.equal).toBe(true)
    expect(j.changes).toBe(0)
    expect(j.valid).toBe(true)
  })

  it('禁止 equal:true && changes>0', async () => {
    for (const [b, a] of [['a', 'b'], ['x\ny', 'x\nz'], ['1\n2\n3', '1\n2\n3\n4']] as const) {
      const r = await toolCall({ action: 'patch', before: b, after: a })
      const j = JSON.parse((r as { text: string }).text)
      expect(j.equal === true && j.changes > 0).toBe(false)
    }
  })
})

describe('审查修复 D-03: patch 拒绝 ignore 选项', () => {
  it('ignoreCase 被明确拒绝', async () => {
    const r = await toolCall({ action: 'patch', before: 'A', after: 'a', ignoreCase: true })
    expect((r as { error: string }).error).toMatch(/patch action does not support ignore/)
  })

  it('ignoreWhitespace 被明确拒绝', async () => {
    const r = await toolCall({ action: 'patch', before: 'a b', after: 'a  b', ignoreWhitespace: true })
    expect((r as { error: string }).error).toMatch(/patch action does not support ignore/)
  })
})

describe('审查修复 D-04: 代码块内容变化', () => {
  it('同语言同行数内容变化 → codeBlockChanges.changed + equal:false', () => {
    const r = markdownDiff('```ts\nold\n```', '```ts\nnew\n```')
    expect(r.equal).toBe(false)
    expect(r.codeBlockChanges).toEqual([{ language: 'ts', beforeLines: 3, afterLines: 3, changed: true }])
  })

  it('语言变化 → changed 不设置，仍报告', () => {
    const r = markdownDiff('```ts\nx\n```', '```js\nx\n```')
    expect(r.equal).toBe(false)
    expect(r.codeBlockChanges[0]).toMatchObject({ language: 'js', beforeLines: 3, afterLines: 3 })
    expect(r.codeBlockChanges[0]!.changed).toBeUndefined()
  })
})

describe('审查修复 D-05: CSV 双侧重复 key 与空/缺失 key', () => {
  it('before 侧重复 key 进入 duplicateKeys 且 equal:false', () => {
    const r = csvDiff('id,name\n1,A\n1,B', 'id,name\n1,A', { key: 'id' })
    expect(r.duplicateKeys).toEqual(['1'])
    expect(r.equal).toBe(false)
    // 重复 key 的行不参与 changed/removed（结果确定）
    expect(r.removedRows).toEqual([])
    expect(r.changedRows).toEqual([])
  })

  it('两侧同时重复 key 合并报告', () => {
    const r = csvDiff('id,name\n2,X\n2,Y', 'id,name\n2,P\n2,Q\n3,R', { key: 'id' })
    expect(r.duplicateKeys).toEqual(['2'])
    expect(r.addedRows).toEqual([{ id: '3', name: 'R' }])
  })

  it('空字符串 key 与缺失 key 不混淆', () => {
    // before：空 key 行；after：缺失 key 行（短行）→ 不算同一行
    const r = csvDiff('id,name\n,empty\n1,one', 'id,name\n1,one', { key: 'id' })
    expect(r.equal).toBe(false)
    expect(r.removedRows).toEqual([{ id: '', name: 'empty' }])
    // 两侧都是空 key → 匹配
    const r2 = csvDiff('id,name\n,empty', 'id,name\n,empty', { key: 'id' })
    expect(r2.equal).toBe(true)
  })
})

describe('审查修复 D-06: ignore 下快速拒绝用归一化键', () => {
  it('无原始 hash 公共行但归一化相等 → 最小 diff 而非全删全增', () => {
    const b = splitLines('Hello\nWorld').lines
    const a = splitLines('hello\nworld\n!').lines
    const ops = diffLines(b, a, { ignoreCase: true })
    const added = ops.filter(o => o.type === 'insert').length
    const removed = ops.filter(o => o.type === 'delete').length
    // 最小：保留 Hello=hello、World=world，仅插入 !（3 ops 而不是 5）
    expect(added).toBe(1)
    expect(removed).toBe(0)
  })

  it('ignoreWhitespace 下中间公共行被保留', () => {
    const r = unifiedDiff('a\nx  y\nb', 'a\nx y\nb', { ignoreWhitespace: true })
    expect(r.stats.addedLines).toBe(0)
    expect(r.stats.removedLines).toBe(0)
    expect(r.diff).toBe('')
  })
})

describe('审查修复 D-07/D-08: patch 信封预算与 stats', () => {
  it('大规模多变更 patch 最终信封 ≤64KiB，截断时 patchComplete:false', async () => {
    const bigBefore = Array.from({ length: 5000 }, (_, i) => `line${i}`).join('\n')
    const bigAfter = bigBefore.split('\n').map((l, i) => (i % 10 === 5 ? l + '!changed' : l)).join('\n')
    const r = await toolCall({ action: 'patch', before: bigBefore, after: bigAfter })
    const j = JSON.parse((r as { text: string }).text)
    expect(utf8ByteLength((r as { text: string }).text)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES)
    if (j.patchComplete === false) {
      expect(j.valid).toBe(false)
      expect(j.truncated).toBe(true)
    }
  })

  it("patch 'a' -> 'a\\n'：stats 与 diff 同源（1/1）", async () => {
    const r = await toolCall({ action: 'patch', before: 'a', after: 'a\n' })
    const j = JSON.parse((r as { text: string }).text)
    expect(j.equal).toBe(false)
    expect(j.stats.addedLines).toBe(1)
    expect(j.stats.removedLines).toBe(1)
    expect(j.valid).toBe(true)
  })

  it('非 ASCII 大输出信封预算', async () => {
    const big = '中'.repeat(60000)
    const r = await toolCall({ action: 'text', before: big, after: big + '文' })
    const text = (r as { text: string }).text
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(MAX_OUTPUT_BYTES)
    expect(JSON.parse(text).equal).toBe(false)
  })
})

describe('审查修复 D-10: JSON 重复键报告', () => {
  it('同一对象重复键被扫描出来', () => {
    expect(scanDuplicateKeys('{"x":1,"x":2}')).toEqual(['x'])
    expect(scanDuplicateKeys('{"a":{"b":1,"b":2},"a":3}')).toEqual(['b', 'a'])
  })

  it('不同层级的同名键不算重复', () => {
    expect(scanDuplicateKeys('{"a":{"a":1}}')).toEqual([])
  })

  it('输出包含 duplicateKeys', async () => {
    const r = await toolCall({ action: 'json', before: '{"x":1,"x":2}', after: '{"x":2}' })
    const j = JSON.parse((r as { text: string }).text)
    expect(j.duplicateKeys.before).toEqual(['x'])
    expect(j.duplicateKeys.after).toEqual([])
  })
})

describe('审查修复 D-11: 孤立 surrogate 拒绝', () => {
  it('assertWellFormedText 拒绝孤立 surrogate', () => {
    expect(() => assertWellFormedText('a\uD800b', 'before')).toThrow(/invalid Unicode/)
    expect(() => assertWellFormedText('ok\uD83D\uDE00', 'before')).not.toThrow()
  })

  it('工具入口拒绝孤立 surrogate', async () => {
    const r = await toolCall({ action: 'text', before: 'a\uD800', after: 'b' })
    expect((r as { error: string }).error).toMatch(/invalid Unicode/)
  })
})

describe('P2: fuzz 合法性与最小性（种子化随机）', () => {
  function rng(seed: number) {
    let a = seed >>> 0
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  function trueDist(b: string[], a: string[]): number {
    const n = b.length, m = a.length
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
    for (let i = 1; i <= n; i++) dp[i][0] = i
    for (let j = 1; j <= m; j++) dp[0][j] = j
    for (let i = 1; i <= n; i++)
      for (let j = 1; j <= m; j++)
        dp[i][j] = Math.min(dp[i - 1][j]! + 1, dp[i][j - 1]! + 1, dp[i - 1][j - 1]! + (b[i - 1] === a[j - 1] ? 0 : 2))
    return dp[n]![m]!
  }
  it('300 组随机输入：ops 重构合法 + 小规模最小', () => {
    const rand = rng(42)
    const alpha = ['a', 'b', 'c', '中']
    for (let t = 0; t < 300; t++) {
      const mk = () => {
        const n = Math.floor(rand() * 40)
        const lines = Array.from({ length: n }, () => alpha[Math.floor(rand() * alpha.length)])
        const text = lines.join('\n')
        return rand() < 0.3 ? text : text + '\n'
      }
      const before = mk()
      const after = mk()
      const { lines: bl } = splitLines(before)
      const { lines: al } = splitLines(after)
      const ops = diffLines(bl, al)
      // 合法性
      const out: string[] = []
      let bi = 0
      for (const op of ops) {
        if (op.type === 'delete') bi++
        else if (op.type === 'insert') out.push(op.text)
        else { out.push(op.text); bi++ }
      }
      expect(out.join('\n')).toBe(al.map(l => l.text).join('\n'))
      // 最小性（小规模 DP）
      if (bl.length * al.length <= 400) {
        const d = trueDist(bl.map(l => l.text), al.map(l => l.text))
        expect(ops.filter(o => o.type !== 'equal').length).toBe(d)
      }
    }
  })
})
