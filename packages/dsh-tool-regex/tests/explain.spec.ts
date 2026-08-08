import { describe, expect, it } from 'vitest'
import { explainPattern } from '../src/explain.ts'

const kinds = (p: string) => explainPattern(p).map(n => n.kind)
const meanings = (p: string) => explainPattern(p).map(n => n.meaning)

describe('explainPattern: 静态解释器', () => {
  it('explains plain literals', () => {
    const nodes = explainPattern('abc')
    expect(nodes).toEqual([
      { kind: 'literal', text: 'a', meaning: 'Literal "a"' },
      { kind: 'literal', text: 'b', meaning: 'Literal "b"' },
      { kind: 'literal', text: 'c', meaning: 'Literal "c"' },
    ])
  })

  it('explains character classes, ranges and negation', () => {
    expect(explainPattern('[a-z]')[0]?.meaning).toMatch(/^Character class: matches one character from \[a-z\]$/)
    expect(explainPattern('[^a-z]')[0]?.meaning).toMatch(/^Negated character class: matches any character NOT in \[a-z\]$/)
    expect(explainPattern('[]')[0]?.meaning).toMatch(/^Character class/)
  })

  it('explains capture, non-capture, named groups and assertions', () => {
    expect(explainPattern('(ab)')[0]?.meaning).toBe('Capturing group')
    expect(explainPattern('(?:ab)')[0]?.meaning).toBe('Non-capturing group')
    expect(explainPattern('(?<name>ab)')[0]?.meaning).toBe('Named capturing group "name"')
    expect(explainPattern('(?=ab)')[0]?.meaning).toBe('Lookahead (positive assertion)')
    expect(explainPattern('(?!ab)')[0]?.meaning).toBe('Negative lookahead')
    expect(explainPattern('(?<=ab)')[0]?.meaning).toBe('Lookbehind (positive assertion)')
    expect(explainPattern('(?<!ab)')[0]?.meaning).toBe('Negative lookbehind')
  })

  it('keeps group text as the full slice', () => {
    const node = explainPattern('a(?:b)c')[1]
    expect(node?.kind).toBe('group')
    expect(node?.text).toBe('(?:b)')
  })

  it('explains quantifiers including braces and lazy forms', () => {
    const q = (p: string) => explainPattern(p)[1]!
    expect(q('a*')?.meaning).toMatch(/0 or more times \(greedy\)/)
    expect(q('a+')?.meaning).toMatch(/1 or more times \(greedy\)/)
    expect(q('a?')?.meaning).toMatch(/0 or 1 times \(greedy\)/)
    expect(q('a*?')?.meaning).toMatch(/0 or more times \(lazy\)/)
    expect(q('a{2}')?.meaning).toMatch(/exactly 2 times/)
    expect(q('a{2,}')?.meaning).toMatch(/2 or more times/)
    expect(q('a{2,4}')?.meaning).toMatch(/between 2 and 4 times/)
    expect(q('a{2,4}?')?.text).toBe('{2,4}?')
  })

  it('treats a non-quantifier brace as a literal', () => {
    expect(explainPattern('a{x}')[1]?.meaning).toBe('Literal "{"')
  })

  it('explains escape classes', () => {
    const m = (p: string) => explainPattern(p)[0]!.meaning
    expect(m('\\d')).toBe('A digit [0-9]')
    expect(m('\\D')).toBe('Not a digit')
    expect(m('\\w')).toBe('A word character [A-Za-z0-9_]')
    expect(m('\\s')).toBe('A whitespace character')
    expect(m('\\b')).toBe('Word boundary')
    expect(m('\\n')).toBe('Newline character')
    expect(m('\\p{L}')).toBe('Unicode property escape')
    expect(m('\\.')).toBe('Escaped literal "."')
  })

  it('explains anchors and alternation', () => {
    expect(explainPattern('^')[0]?.meaning).toMatch(/^Start anchor/)
    expect(explainPattern('$')[0]?.meaning).toMatch(/^End anchor/)
    expect(explainPattern('a|b')[1]?.kind).toBe('alternation')
    expect(explainPattern('.')[0]?.meaning).toMatch(/Any character except line terminators/)
  })

  it('orders nodes correctly on a mixed pattern', () => {
    const k = kinds('\\d{4}-\\d{2}')
    expect(k).toEqual(['escape', 'quantifier', 'literal', 'escape', 'quantifier'])
  })

  it('handles nested groups and classes inside groups', () => {
    const k = kinds('(a(b[c-d])e)')
    expect(k[0]).toBe('group') // 外层组整体为一个节点
    const outer = explainPattern('(a(b[c-d])e)')[0]
    expect(outer?.text).toBe('(a(b[c-d])e)')
  })

  it('errors on unbalanced parentheses and classes', () => {
    expect(() => explainPattern('(ab')).toThrow('regex: explain: unmatched "(" at position 0')
    expect(() => explainPattern('ab)')).toThrow('regex: explain: unmatched ")" at position 2')
    expect(() => explainPattern('[ab')).toThrow('regex: explain: unmatched "[" at position 0')
    expect(() => explainPattern('(?<name')).toThrow(/unterminated named group/)
    expect(() => explainPattern('(?<name>ab')).toThrow('regex: explain: unmatched "(" at position 0')
  })

  it('rejects non-string patterns', () => {
    expect(() => explainPattern(7 as unknown as string)).toThrow('regex: pattern must be a string')
  })
})
