# dsh-tool-markdown

[中文](README.md)

DSH Markdown tool plugin — HTML↔Markdown conversion, GFM table normalization, table-of-contents generation. Zero dependencies, pure functions, hand-written lightweight parser.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

The most common document scenarios for models: the user pastes a block of HTML (web page source, email, exported file), pastes a table asking for cleanup, or asks to "convert to markdown". Without a tool, the model can only hard-code the handling — HTML entities go wrong, tables get mangled, and web noise (nav/scripts/ads) leaks in. This plugin provides deterministic conversion and complements `dsh-tool-csv`: **csv handles structured tables, markdown handles documents/web pages**.

## Security model

- **Zero dependencies**: hand-written recursive-descent HTML parser (no cheerio/jsdom — they add tens of MB and are an attack surface)
- **Zero execution surface**: no eval, no new Function, no remote resource loading, no CSS layout parsing
- **Content stripping**: script/style/iframe/object/noscript contents are stripped entirely (security + noise)
- **md2html whitelist**: only outputs `p h1-h6 ul ol li blockquote pre code a img strong em br hr table thead tbody tr th td`; all text is HTML-escaped — a `<script>` embedded in markdown is only displayed as text
- **Link scheme whitelist**: `http/https/mailto`; `javascript:`/`data:` links degrade to plain text
- **Resource limits**: nesting deeper than 64 levels errors (prevents stack overflow); input `maxBytes` defaults to 256 KB with a hard cap of 1 MB (errors on exceeding, never truncates)
- Tool arguments are recorded in session logs; **do not pass in HTML containing secrets/session data**

## Tool declaration

Registers the `markdown` tool (`@deepseek-ai/dsh-tool-markdown`, row id `tool-markdown`) with unified text output.

| parameter | type | required | description |
|---|---|---|---|
| `action` | string | ✅ | `html2md` / `md2html` / `table` / `toc` |
| `html` | string | | html2md input (fragment or full document) |
| `markdown` | string | | md2html/toc input |
| `text` | string | | table input (HTML `<table>` or pipe-delimited text) |
| `baseUrl` | string | | Base for resolving relative href/src (naive join) |
| `maxBytes` | integer | | Input cap, default 256000, hard max 1000000 |

## Actions

| action | function |
|---|---|
| `html2md` | HTML → GFM Markdown: full block/inline mapping, tables to GFM (colspan placeholder padding), entity decoding, script/style stripping, link scheme filtering (**no readability article extraction** — nav/header/footer pass through by default) |
| `md2html` | Markdown → whitelist-safe HTML: all text escaped, no tag can escape |
| `table` | HTML `<table>` or pipe-delimited text **containing unescaped `\|`** → GFM table (column padding, `\|` escaping, separator row detection; errors on input without pipes) |
| `toc` | Markdown headings → nested table-of-contents list (simplified GitHub-style anchors: duplicate headings get automatic -1/-2 suffixes, fake headings inside code fences are skipped) |

## Examples

```
markdown { action: "html2md", html: "<h1>标题</h1><p>你好 <b>世界</b></p>" }
  → # 标题\n\n你好 **世界**

markdown { action: "md2html", markdown: "[x](javascript:alert(1))" }
  → <p>x</p>          ← javascript: 链接降级为纯文本

markdown { action: "table", text: "a|b\n1|2" }
  → | a | b |\n| --- | --- |\n| 1 | 2 |

markdown { action: "toc", markdown: "# 标题一\n## 小节" }
  → - [标题一](#标题一)\n  - [小节](#小节)
```

## Edge-case behavior

| case | handling |
|---|---|
| Unclosed tags | Auto-closed at EOF (consistent with browsers); auto-closed on block-level elements inside `<p>` |
| Case | Tag/attribute names normalized to lowercase |
| Comments/DOCTYPE/CDATA | Stripped |
| Entities | Named + numeric entities decoded; unknown entities kept literally (`&amp;lt;` → `&lt;`, no double decoding) |
| Nested lists | `li` is only closed by a new `li` — nested `ul/ol` is legal (2 spaces/level indentation) |
| Whitespace | Inline collapsed to single spaces; `pre/code` preserved as-is |
| Tables | First row (thead `th` or first-row `td`) is the header; `colspan=N` pads N-1 placeholder cells |
| Depth > 64 levels | `markdown: HTML nesting exceeds 64 levels` |
| Input over limit | `markdown: <label> exceeds N bytes` (no truncation) |
| Embedded HTML in md2html | Escaped as text as-is; whitelist-external tags are never output |

## npm 0.1.0-rc.8 compatibility (verified)

This plugin has been migrated to the npm 0.1.0-rc.8 dependency line and fully verified in an isolated consumer of `@deepseek-ai/dsh@0.1.0-rc.8`:

- **Types/runtime**: `@deepseek-ai/cordis@^4.0.1` + `@deepseek-ai/dsh-tools@>=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants@>=0.0.1-rc.1 <0.2.0` (peer); no longer depends on unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies are self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption verification**: tarball installed into the 0.1.0-rc.8 consumer → `dsh --profile compat --dump-config` shows this plugin's row → the tool actually registers and executes
- **Startup**: `npx -p @deepseek-ai/dsh@0.1.0-rc.8 dsh web` (lib production mode; do not `install -g` globally)


## Installation

Plugin source repository: `https://github.com/omdsh-dev/dsh-tool-markdown` (public).

### Profile Bundle (recommended)

Install this plugin as a standalone bundle into a profile (DSH 0.1.0-rc.8, npm):

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-markdown
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-markdown
```

The `dsh.bundle.patch` inside the package automatically adds the plugin to the profile's layer stack after installation (row id: `tool-markdown`).

> ⚠️ web and headless are **different profiles**: installing into web does not automatically cover headless; `dsh run` uses the headless profile by default.

### Install via npm pack tarball

```sh
npm pack    # generates dsh-tool-markdown-*.tgz
dsh plugin --profile web add ./dsh-tool-markdown-*.tgz
dsh plugin --profile headless add ./dsh-tool-markdown-*.tgz
```

### Verify installation

```sh
dsh --profile web --dump-config | grep tool-markdown
```

### Run verification

```sh
dsh run "使用 markdown 工具把 <h1>标题</h1> 转成 Markdown"
```

### Manual installation and legacy compatibility

Only for legacy snapshots that do not support Profile Bundle, or plugin development/debugging environments (local junction/symlink, manually editing profile layers).
## Testing

```bash
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

- `html.spec.ts`: parser boundaries (nesting/unclosed/case/self-closing/comments/script stripping/entities/malformed attributes/depth guard)
- `html2md.spec.ts`: full block/inline mapping table, tables (colspan/header/escaping), scheme filtering, baseUrl
- `md2html.spec.ts`: whitelist structure + security (embedded script escaping, javascript: degradation, quote escaping)
- `table.spec.ts`: HTML/pipe inputs, column padding, `\|` escaping; `toc.spec` TOC and slugify
- `register.spec.ts`: registration contract (AUDIT-CROSS-02 style)

## License

MIT
