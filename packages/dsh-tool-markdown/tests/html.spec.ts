import { describe, expect, it } from 'vitest'
import { parseHtml, decodeEntities, ROOT_TAG, type HtmlNode } from '../src/html.ts'

const tags = (html: string) => parseHtml(html).children.filter(n => n.type === 'element').map(n => n.tag)
const texts = (html: string) => {
  const out: Array<string | undefined> = []
  const walk = (n: HtmlNode): void => {
    if (n.type === 'text') out.push(n.text)
    for (const c of n.children) walk(c)
  }
  walk(parseHtml(html))
  return out
}

describe('parseHtml: 基础结构', () => {
  it('parses a nested structure', () => {
    const root = parseHtml('<p>a<b>b</b></p>')
    const p = root.children[0]!
    expect(p.type).toBe('element')
    expect(p.tag).toBe('p')
    expect(p.children).toHaveLength(2)
    expect(p.children[1]).toMatchObject({ type: 'element', tag: 'b' })
  })

  it('auto-closes unclosed tags at EOF', () => {
    const root = parseHtml('<p>a<div>b')
    const t = tags('<p>a<div>b')
    expect(t).toEqual(['p', 'div']) // p 在 div 到来时自动闭合
  })

  it('normalizes tag and attribute case', () => {
    const root = parseHtml('<DIV DATA-X="1">t</DIV>')
    expect(root.children[0]).toMatchObject({ type: 'element', tag: 'div' })
    const attrs = (root.children[0] as any).attrs
    expect(Object.keys(attrs)).toEqual(['data-x'])
  })

  it('handles self-closing tags (<br>, <br/>, <img src=x>)', () => {
    expect(tags('<br>')).toEqual(['br'])
    expect(tags('<br/>')).toEqual(['br'])
    const img = parseHtml('<img src=x>').children[0] as any
    expect(img.tag).toBe('img')
    expect(img.attrs['src']).toBe('x')
    expect(img.children).toEqual([])
  })

  it('strips comments, DOCTYPE and CDATA', () => {
    expect(texts('a<!-- comment -->b')).toEqual(['ab'])
    expect(texts('<!DOCTYPE html><p>x</p>')).toEqual(['x'])
    expect(texts('<![CDATA[raw]]>x')).toEqual(['x'])
  })

  it('strips script/style content entirely, keeps surrounding text', () => {
    const root = parseHtml('<script>evil()</script><p>ok</p>')
    expect(tags('<script>evil()</script><p>ok</p>')).toEqual(['p'])
    expect(root.children[0]!.tag).toBe('p')
  })

  it('decodes entities (named and numeric), keeps unknown literal', () => {
    expect(texts('&lt;b&gt; &amp; &quot; &#123; &#x7B; &nope;')).toEqual(['<b> & " { { &nope;'])
  })

  it('decodes nested-looking entities once', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })

  it('parses malformed attributes (quoted, unquoted, boolean)', () => {
    const root = parseHtml('<a a="1" b=\'2\' c d=3>')
    const attrs = (root.children[0] as any).attrs
    expect(attrs).toEqual({ a: '1', b: '2', c: '', d: '3' })
  })

  it('enforces the depth guard', () => {
    expect(() => parseHtml('<div>'.repeat(65) + 'x', { maxDepth: 64 }))
      .toThrow('markdown: HTML nesting exceeds 64 levels')
  })

  it('accepts input within the depth limit', () => {
    expect(() => parseHtml('<div>'.repeat(64) + 'x', { maxDepth: 64 })).not.toThrow()
  })

  it('produces a #root wrapper with element children', () => {
    const root = parseHtml('plain text')
    expect(root.tag).toBe(ROOT_TAG)
    expect(root.children[0]?.text).toBe('plain text')
  })

  it('handles plain text without tags', () => {
    expect(texts('just text')).toEqual(['just text'])
  })

  it('treats lone "<" as literal text', () => {
    expect(texts('a < b')).toEqual(['a < b'])
  })
})
