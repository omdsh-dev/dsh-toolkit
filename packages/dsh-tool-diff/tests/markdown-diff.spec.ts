import { describe, expect, it } from 'vitest'
import { tokenizeMarkdown, markdownDiff } from '../src/markdown-diff.ts'

const DOC = [
  '# Title',
  '',
  'intro paragraph',
  '',
  '## Install',
  '',
  '- step one',
  '- step two',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
  '> a quote',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
].join('\n')

describe('tokenizeMarkdown', () => {
  it('识别标题/段落/列表/代码块/引用/表格', () => {
    const blocks = tokenizeMarkdown(DOC)
    const kinds = blocks.map(b => b.kind)
    expect(kinds).toContain('heading')
    expect(kinds).toContain('paragraph')
    expect(kinds).toContain('list')
    expect(kinds).toContain('fence')
    expect(kinds).toContain('quote')
    expect(kinds).toContain('table')
  })

  it('标题路径正确（层级嵌套）', () => {
    const blocks = tokenizeMarkdown('# A\n\n## B\n\n### C\n\n## D')
    const heads = blocks.filter(b => b.kind === 'heading')
    expect(heads.map(h => h.path)).toEqual(['A', 'A > B', 'A > B > C', 'A > D'])
  })

  it('无法识别的语法按普通块保留', () => {
    const blocks = tokenizeMarkdown('::: custom\nstuff\n:::')
    expect(blocks.filter(b => b.kind === 'paragraph')).toHaveLength(1)
    expect(blocks.some(b => b.text.includes(':::'))).toBe(true)
  })

  it('CRLF/LF 等价', () => {
    const a = tokenizeMarkdown('# A\r\n\r\npara\r\n')
    const b = tokenizeMarkdown('# A\n\npara\n')
    expect(a.map(x => [x.kind, x.text])).toEqual(b.map(x => [x.kind, x.text]))
  })
})

describe('markdownDiff: 标题变化', () => {
  it('标题新增/删除', () => {
    const r = markdownDiff(DOC, DOC + '\n\n## New Section')
    expect(r.headingChanges).toEqual([{ op: 'add', after: 'New Section', level: 2, index: 3 }])
    expect(r.equal).toBe(false)
  })

  it('标题重命名', () => {
    const changed = DOC.replace('## Install', '## Install and Verify')
    const r = markdownDiff(DOC, changed)
    expect(r.headingChanges).toEqual([
      { op: 'rename', before: 'Install', after: 'Install and Verify', level: 2, index: 2 },
    ])
  })

  it('标题层级变化 → remove + add', () => {
    const changed = DOC.replace('## Install', '### Install')
    const r = markdownDiff(DOC, changed)
    const ops = r.headingChanges.map(h => h.op)
    expect(ops).toContain('remove')
    expect(ops).toContain('add')
  })

  it('完全一致 → equal 且无 diff', () => {
    const r = markdownDiff(DOC, DOC)
    expect(r.equal).toBe(true)
    expect(r.diff).toBe('')
  })
})

describe('markdownDiff: 块变化', () => {
  it('段落替换', () => {
    const changed = DOC.replace('intro paragraph', 'new intro')
    const r = markdownDiff(DOC, changed)
    const replaces = r.blockChanges.filter(b => b.op === 'replace')
    expect(replaces.length).toBeGreaterThan(0)
    expect(replaces.some(b => b.before === 'intro paragraph' && b.after === 'new intro')).toBe(true)
  })

  it('列表增删', () => {
    const changed = DOC + '\n\n- step three'
    const r = markdownDiff(DOC, changed)
    expect(r.blockChanges.some(b => b.op === 'add' && b.after?.includes('step three'))).toBe(true)
  })

  it('代码块语言变化与行数变化', () => {
    const changed = DOC.replace('```ts', '```js').replace('const x = 1', 'const x = 1\nconst y = 2')
    const r = markdownDiff(DOC, changed)
    expect(r.codeBlockChanges).toEqual([
      { language: 'js', beforeLines: 3, afterLines: 4 },
    ])
  })

  it('GFM 表格行变化', () => {
    const changed = DOC.replace('| 1 | 2 |', '| 1 | 3 |')
    const r = markdownDiff(DOC, changed)
    expect(r.blockChanges.some(b => b.op === 'replace' && b.before?.includes('| 1 | 2 |'))).toBe(true)
  })

  it('引用块变化', () => {
    const changed = DOC.replace('> a quote', '> a different quote')
    const r = markdownDiff(DOC, changed)
    expect(r.blockChanges.some(b => b.op === 'replace' && b.before === '> a quote')).toBe(true)
  })

  it('ignoreWhitespace 生效', () => {
    const changed = DOC.replace('intro paragraph', 'intro   paragraph')
    const r1 = markdownDiff(DOC, changed)
    expect(r1.equal).toBe(false)
    const r2 = markdownDiff(DOC, changed, { ignoreWhitespace: true })
    expect(r2.equal).toBe(true)
  })

  it('块路径形如 h2[1]/p[0]', () => {
    const changed = DOC.replace('intro paragraph', 'x')
    const r = markdownDiff(DOC, changed)
    const p = r.blockChanges.find(b => b.op === 'replace')
    expect(p?.path).toMatch(/^h[1-6]\[\d+\]\/p\[\d+\]$/)
  })
})
