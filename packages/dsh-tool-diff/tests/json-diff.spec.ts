import { describe, expect, it } from 'vitest'
import { jsonDiff, jsonDiffText } from '../src/json-diff.ts'

describe('jsonDiff: 标量与基础结构', () => {
  it('primitive replace', () => {
    expect(jsonDiff(1, 2)).toEqual([{ path: '$', kind: 'replace', before: 1, after: 2 }])
  })

  it('完全相同 → 空', () => {
    expect(jsonDiff({ a: 1 }, { a: 1 })).toEqual([])
  })

  it('object add/remove/replace', () => {
    const c = jsonDiff({ a: 1, b: 2 }, { a: 1, c: 3 })
    expect(c).toEqual([
      { path: '$.b', kind: 'remove', before: 2 },
      { path: '$.c', kind: 'add', after: 3 },
    ])
  })

  it('nested object path', () => {
    const c = jsonDiff({ user: { name: 'Alice' } }, { user: { name: 'Bob' } })
    expect(c).toEqual([{ path: '$.user.name', kind: 'replace', before: 'Alice', after: 'Bob' }])
  })

  it('array index diff', () => {
    const c = jsonDiff(['a', 'b'], ['a', 'c'])
    expect(c).toEqual([{ path: '$[1]', kind: 'replace', before: 'b', after: 'c' }])
  })

  it('数组长度变化 add/remove', () => {
    const c = jsonDiff(['a'], ['a', 'b', 'c'])
    expect(c).toEqual([
      { path: '$[1]', kind: 'add', after: 'b' },
      { path: '$[2]', kind: 'add', after: 'c' },
    ])
  })

  it('空对象与空数组相等', () => {
    expect(jsonDiff({}, {})).toEqual([])
    expect(jsonDiff([], [])).toEqual([])
  })

  it('null 与缺失属性区别', () => {
    const c = jsonDiff({ a: null }, {})
    expect(c).toEqual([{ path: '$.a', kind: 'remove', before: null }])
    const c2 = jsonDiff({}, { a: null })
    expect(c2).toEqual([{ path: '$.a', kind: 'add', after: null }])
  })

  it('类型不同 → replace', () => {
    const c = jsonDiff({ a: 1 }, { a: '1' })
    expect(c).toEqual([{ path: '$.a', kind: 'replace', before: 1, after: '1' }])
    const c2 = jsonDiff({ a: [1] }, { a: { 0: 1 } })
    expect(c2[0]!.kind).toBe('replace')
  })
})

describe('jsonDiff: 键排序与特殊键名', () => {
  it('key sorting 输出可复现', () => {
    const c = jsonDiff({ z: 1, a: 2 }, { z: 2, a: 3 })
    expect(c.map(x => x.path)).toEqual(['$.a', '$.z'])
    const c2 = jsonDiff({ z: 1, a: 2 }, { z: 2, a: 3 }, { sortKeys: false })
    expect(c2.map(x => x.path)).toEqual(['$.z', '$.a'])
  })

  it('特殊键名（点号/括号/引号）用括号记法', () => {
    const c = jsonDiff({ 'a.b': 1 }, { 'a.b': 2 })
    expect(c[0]!.path).toBe("$['a.b']")
    const c2 = jsonDiff({ 'x[y]': 1 }, { 'x[y]': 2 })
    expect(c2[0]!.path).toBe("$['x[y]']")
    const c3 = jsonDiff({ 'we"ird': 1 }, { 'we"ird': 2 })
    expect(c3[0]!.path).toBe('$[\'we"ird\']')
  })

  it('空字符串键', () => {
    const c = jsonDiff({ '': 1 }, { '': 2 })
    expect(c[0]!.path).toBe("$['']")
  })

  it('ignoreCase 生效', () => {
    expect(jsonDiff({ a: 'Hello' }, { a: 'hello' })).toHaveLength(1)
    expect(jsonDiff({ a: 'Hello' }, { a: 'hello' }, { ignoreCase: true })).toEqual([])
  })
})

describe('jsonDiffText: 文本入口', () => {
  it('invalid JSON 报错', () => {
    expect(() => jsonDiffText('{bad', '{}')).toThrow(/not valid JSON/)
    expect(() => jsonDiffText('{}', 'not json')).toThrow(/not valid JSON/)
  })

  it('深度超限在入口报错（不进入 diff）', () => {
    const deep = '{"a":'.repeat(80) + '1' + '}'.repeat(80)
    expect(() => jsonDiffText(deep, deep)).toThrow(/nesting exceeds 64/)
  })

  it('字符串内的括号不计入深度', () => {
    const text = '{"a": "{[{(("}'
    const res = jsonDiffText(text, text)
    expect(res.changes).toEqual([])
  })

  it('大数组 diff 正常完成', () => {
    const big = Array.from({ length: 5000 }, (_, i) => i)
    const big2 = [...big]
    big2[2500] = -1
    const res = jsonDiffText(JSON.stringify(big), JSON.stringify(big2))
    expect(res.changes).toEqual([{ path: '$[2500]', kind: 'replace', before: 2500, after: -1 }])
  })
})
