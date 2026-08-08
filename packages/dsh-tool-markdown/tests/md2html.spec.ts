import { describe, expect, it } from 'vitest'
import { md2html, escapeHtml } from '../src/md2html.ts'

describe('md2html: 白名单结构', () => {
  it('converts headings', () => {
    expect(md2html('# a\n## b')).toBe('<h1>a</h1>\n<h2>b</h2>\n')
  })

  it('converts fenced code blocks', () => {
    expect(md2html('```js\nconst x = 1\n```')).toBe('<pre><code class="language-js">const x = 1</code></pre>\n')
  })

  it('converts blockquotes and lists', () => {
    expect(md2html('> quote')).toBe('<blockquote><p>quote</p></blockquote>\n')
    expect(md2html('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>\n')
    expect(md2html('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>\n')
  })

  it('converts tables with separator detection', () => {
    const out = md2html('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(out).toBe('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>\n')
  })

  it('converts inline code, bold and italic', () => {
    expect(md2html('`c` **b** *i*')).toBe('<p><code>c</code> <strong>b</strong> <em>i</em></p>\n')
  })

  it('converts links and images', () => {
    expect(md2html('[t](https://a.b)')).toBe('<p><a href="https://a.b">t</a></p>\n')
    expect(md2html('![alt](https://a.b/i.png)')).toBe('<p><img src="https://a.b/i.png" alt="alt"></p>\n')
  })
})

describe('md2html: 安全', () => {
  it('escapes embedded raw HTML (script cannot escape the whitelist)', () => {
    const out = md2html('<script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('degrades javascript: links to plain text', () => {
    const out = md2html('[x](javascript:alert(1))')
    expect(out).not.toContain('<a')
    expect(out).toBe('<p>x</p>\n')
  })

  it('degrades data: image links to plain alt text', () => {
    const out = md2html('![x](data:text/html;base64,AA)')
    expect(out).not.toContain('<img')
    expect(out).toContain('x')
  })

  it('escapes quotes and ampersands in text', () => {
    expect(escapeHtml('a<b>&"\'')).toBe('a&lt;b&gt;&amp;&quot;&#39;')
  })

  it('never outputs script/iframe/object tags', () => {
    const out = md2html('# t\n\n[link](https://ok.example)')
    expect(out).not.toMatch(/<(script|iframe|object|style)\b/i)
  })

  it('handles unclosed inline markers gracefully', () => {
    expect(md2html('**unclosed')).toBe('<p>**unclosed</p>\n')
  })

  it('normalizes control characters and case in URLs (MD-01/MD-02)', () => {
    // 前导控制空白不再绕过 scheme 检查
    expect(md2html('[x](\tjavascript:alert(1))')).toBe('<p>x</p>\n')
    expect(md2html('[x](\njavascript:alert(1))')).toBe('<p>x</p>\n')
    // 大写 scheme 合法保留
    expect(md2html('[x](HTTPS://example.com)')).toBe('<p><a href="HTTPS://example.com">x</a></p>\n')
    expect(md2html('[x](HTTP://example.com)')).toBe('<p><a href="HTTP://example.com">x</a></p>\n')
    // 混合大小写危险 scheme 降级
    expect(md2html('[x](JaVaScRiPt:alert(1))')).toBe('<p>x</p>\n')
  })
})
