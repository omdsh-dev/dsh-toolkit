import { describe, expect, it } from 'vitest'
import { html2md } from '../src/html2md.ts'

describe('html2md: 块级映射', () => {
  it('maps h1-h6 to #-######', () => {
    expect(html2md('<h1>a</h1><h2>b</h2><h3>c</h3><h6>f</h6>'))
      .toBe('# a\n\n## b\n\n### c\n\n###### f\n')
  })

  it('maps paragraphs with blank-line separation', () => {
    expect(html2md('<p>one</p><p>two</p>')).toBe('one\n\ntwo\n')
  })

  it('maps ul/ol/li with nesting indent', () => {
    expect(html2md('<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>'))
      .toBe('- a\n- b\n  - c\n')
  })

  it('maps ordered lists with sequential numbers', () => {
    expect(html2md('<ol><li>x</li><li>y</li></ol>')).toBe('1. x\n2. y\n')
  })

  it('maps blockquote with per-line prefix', () => {
    expect(html2md('<blockquote>line one\nline two</blockquote>')).toBe('> line one\n> line two\n')
  })

  it('maps pre to a fenced code block with language sniffing', () => {
    expect(html2md('<pre class="language-js"><code>const a = 1</code></pre>'))
      .toBe('```js\nconst a = 1\n```\n')
    expect(html2md('<pre><code>x</code></pre>')).toBe('```\nx\n```\n')
  })

  it('maps hr to ---', () => {
    expect(html2md('<hr>')).toBe('---\n')
  })
})

describe('html2md: 行内映射', () => {
  it('maps strong/b and em/i', () => {
    expect(html2md('<p><strong>s</strong> <em>e</em> <b>b</b> <i>i</i></p>'))
      .toBe('**s** *e* **b** *i*\n')
  })

  it('maps code spans', () => {
    expect(html2md('<p><code>x()</code></p>')).toBe('`x()`\n')
  })

  it('maps links with title', () => {
    expect(html2md('<a href="https://a.b" title="t">link</a>'))
      .toBe('[link](https://a.b "t")\n')
  })

  it('degrades javascript:/data: links to plain text', () => {
    expect(html2md('<a href="javascript:alert(1)">x</a>')).toBe('x\n')
    expect(html2md('<a href="data:text/html;base64,AA">x</a>')).toBe('x\n')
  })

  it('maps img with alt/src/title', () => {
    expect(html2md('<img src="https://a.b/i.png" alt="pic" title="t">'))
      .toBe('![pic](https://a.b/i.png "t")\n')
  })

  it('resolves relative hrefs with baseUrl', () => {
    expect(html2md('<a href="/docs">d</a>', { baseUrl: 'https://site.com/base/' }))
      .toBe('[d](https://site.com/base/docs)\n')
  })

  it('collapses inline whitespace', () => {
    expect(html2md('<p>a   b\n\tc</p>')).toBe('a b c\n')
  })
})

describe('html2md: 表格', () => {
  it('converts a simple table to GFM with th header', () => {
    const md = html2md('<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>')
    expect(md).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |\n')
  })

  it('uses the first td row as header when no thead', () => {
    const md = html2md('<table><tr><td>h1</td><td>h2</td></tr><tr><td>x</td><td>y</td></tr></table>')
    expect(md).toBe('| h1 | h2 |\n| --- | --- |\n| x | y |\n')
  })

  it('pads colspan with placeholder cells', () => {
    const md = html2md('<table><tr><td colspan="2">wide</td><td>c</td></tr><tr><td>a</td><td>b</td><td>d</td></tr></table>')
    expect(md).toBe('| wide |  | c |\n| --- | --- | --- |\n| a | b | d |\n')
  })

  it('escapes pipes inside cell text', () => {
    const md = html2md('<table><tr><th>a|b</th></tr></table>')
    expect(md).toBe('| a\\|b |\n| --- |\n')
  })
})

describe('html2md: 安全与语义保持（审查修复）', () => {
  it('escapes markdown metacharacters in plain text (MD-03)', () => {
    expect(html2md('<p>*literal*</p>')).toBe('\\*literal\\*\n')
    expect(html2md('<p># heading</p>')).toBe('\\# heading\n')
    expect(html2md('<p>- item</p>')).toBe('\\- item\n')
    expect(html2md('<p>1. item</p>')).toBe('1\\. item\n')
    expect(html2md('<p>[x](https://a.b)</p>')).toBe('\\[x\\]\\(https://a.b\\)\n')
    expect(html2md('<p>a &lt; b &gt; c</p>')).toBe('a \\< b \\> c\n')
  })

  it('escapes line-start markers inside container text (MD-03)', () => {
    expect(html2md('<div># fake</div>')).toBe('\\# fake\n')
  })

  it('keeps inline formatting working after escaping (strong/em still render)', () => {
    expect(html2md('<p><strong>s</strong> <em>e</em></p>')).toBe('**s** *e*\n')
  })

  it('normalizes control characters and case in URLs (MD-01/MD-02)', () => {
    expect(html2md('<a href="&#x09;javascript:alert(1)">x</a>')).toBe('x\n')
    expect(html2md('<a href="&#10;javascript:alert(1)">x</a>')).toBe('x\n')
    expect(html2md('<a href="HTTP://example.com">ok</a>')).toBe('[ok](HTTP://example.com)\n')
    expect(html2md('<a href="JaVaScRiPt:alert(1)">x</a>')).toBe('x\n')
  })

  it('selects a safe fence length when code contains backticks (MD-04)', () => {
    expect(html2md('<pre><code>aaa\n```\nevil\n```\nbbb</code></pre>'))
      .toBe('````\naaa\n```\nevil\n```\nbbb\n````\n')
    expect(html2md('<pre><code>````x````</code></pre>')).toBe('`````\n````x````\n`````\n')
  })

  it('escapes markdown metacharacters inside table cells (MD-03)', () => {
    expect(html2md('<table><tr><td>*x*</td><td>a|b</td></tr></table>'))
      .toBe('| \\*x\\* | a\\|b |\n| --- | --- |\n')
  })
})

describe('html2md: 噪音与容器', () => {
  it('strips script/style and passes through unknown containers', () => {
    const md = html2md('<div><script>bad()</script><p>ok</p></div><section><p>s</p></section>')
    expect(md).toBe('ok\n\ns\n')
  })

  it('avoids blank-line noise from nested block elements', () => {
    expect(html2md('<div><p>text</p></div>')).toBe('text\n')
  })
})
