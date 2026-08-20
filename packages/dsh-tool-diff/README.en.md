# dsh-tool-diff

[中文](README.md)

DSH Diff text-difference tool plugin — structured comparison of text / JSON / CSV / Markdown and unified diff generation. Zero dependencies, pure functions, read-only.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

When an agent needs to compare two pieces of content (config snippets, API responses, tables, document revisions), the existing path is to spawn a `bash` process to call the system diff or hand-write comparison logic:

1. **Every call spawns a process** — especially expensive on Windows
2. **The system diff doesn't understand structure** — for JSON it can only give whole-text differences, and can't reveal path-level changes like `$.user.name`
3. **Hand-written comparison code isn't verifiable** — edge cases (commas inside quotes, nested arrays, heading renames) are highly error-prone

This plugin provides deterministic, zero-dependency, pure-function diffing: a single function call returns a structured JSON report or a standard unified diff in milliseconds.

## Security Model

- **Zero dependencies**: the Myers line-level diff, RFC 4180 parser, and JSON recursive comparison are all hand-written
- **Read-only**: no file reads, no file writes, no network, no git invocation; the `patch` action only generates and validates the patch in memory, never writes to disk
- **Budgets**:
  - Input per side ≤ 256 KiB (errors directly beyond the limit)
  - Output ≤ 64 KiB (truncated by `maxChanges` and the byte budget beyond the limit, with `truncated` set)
  - Myers diagonal budget 2000 + total snake-step budget 20 million + common prefix/suffix trimming + hash-based quick rejection + a 4000-line size cap → malicious duplicate/fully-different texts complete within bounds
  - Lines ≤ 50K, JSON nesting ≤ 64 levels, CSV ≤ 50K rows / 512 columns
  - `timeoutMs: 2000`
- Tool arguments are recorded in the session log; don't pass sensitive data

## Tool Declaration

Registers the `diff` tool (`@deepseek-ai/dsh-tool-diff`, row id `tool-diff`), uniformly outputting a JSON text-string envelope: every action carries a common summary `{ equal, truncated, beforeBytes, afterBytes, changes }`.

| action | Purpose | Output |
|---|---|---|
| `text` | Line-level Myers diff | unified diff (`--- before` / `+++ after` / `@@` hunks, no timestamps) + statistics; `format=structured` outputs an operation list with line numbers |
| `json` | Recursively compare two JSON values | `$`-path changes (`$.user.name`, `$.items[0]`, `$['a.b']`) + add/remove/replace summary |
| `csv` | Parse with RFC 4180, then compare by primary key or position | `addedRows` / `removedRows` / `changedRows` (column-level) / `duplicateKeys` / column-set changes |
| `markdown` | Lightweight block-level tokenizer (headings/code blocks/lists/blockquotes/tables) | `headingChanges` (rename detection) / `blockChanges` (`h2[1]/p[0]` paths) / `codeBlockChanges` + full-text diff |
| `patch` | Generate a unified diff and validate it in memory | patch text + `valid` / `hunks` / `targetMatchesAfter` / hunk-level errors |

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | `text` / `json` / `csv` / `markdown` / `patch` |
| `before` | string | ✅ | Original content (input side for any action) |
| `after` | string | ✅ | New content |
| `format` | string | | `unified` (default for text/patch) / `structured` (default for json/csv/markdown) / `both` |
| `context` | integer | | Number of unified context lines, default 3, range 0..20 |
| `key` | string | | CSV primary key column name or 1-based index; absent → positional comparison |
| `delimiter` | string | | CSV delimiter, default `,`, a single character or `tab` |
| `ignoreWhitespace` | boolean | | Ignore whitespace differences when comparing (text/csv/markdown); **rejected by the patch action** (exact-text protocol) |
| `ignoreCase` | boolean | | Ignore case when comparing (text/json/csv/markdown); **rejected by the patch action** |
| `sortKeys` | boolean | | Sort JSON keys, default true |
| `maxChanges` | integer | | Max number of reported changes, default 1000, hard cap 10000 |

## Example Output

```json
{"kind":"json","equal":false,"beforeBytes":42,"afterBytes":58,"changes":[
  {"op":"replace","path":"$.tags[1]","before":"b","after":"c"},
  {"op":"add","path":"$.user.email","after":"b@x.com"},
  {"op":"replace","path":"$.user.name","before":"Alice","after":"Bob"}],
 "summary":{"added":1,"removed":0,"replaced":2,"moved":0}}
```

## Design Highlights

- **Line-level Myers**: iterative O(ND) implementation (non-recursive) with trace backtracking; runs at small scale after common prefix/suffix trimming, keeping memory and time bounded; quick rejection uses the same normalization keys as `lineEqual` (common lines aren't missed under the ignore options)
- **CSV dual mode**: `key` provided and a header present → keyed (row order irrelevant); otherwise positional (by data row number). Duplicate keys on **either the before or after side** go into `duplicateKeys` with `equal=false`, and rows with duplicate keys don't participate in matching (deterministic results); empty-string keys and missing keys (`<missing-key>`) are never confused
- **Markdown block alignment**: Myers over block-type tokens; content changes within same-type blocks → `replace`, structural additions/removals → `add/remove`; headings are matched by parent path + level, and same-path same-level text changes → `rename`; any change in code block language/line count/content goes into `codeBlockChanges` (content changes carry `changed:true`)
- **JSON depth defense**: an O(n) non-recursive bracket scan (skipping string literals) before `JSON.parse`; depth over 64 errors directly; **duplicate keys** are scanned by a state machine and reported with the output (`duplicateKeys.before/after`), never silently dropped
- **patch semantics**: `equal` = both sides equal under exact-line and trailing-newline semantics (unrelated to `valid`); `valid` only means "the generated patch applies from before to after"; hunk coordinates (old/new, order, overlap, gaps) are strictly validated; when the patch is truncated → `valid:false` + `patchComplete:false`
- **Unicode**: lone surrogates are rejected at the entry (`invalid Unicode`)
- **Reproducible output**: unified diff has no timestamps; `sortKeys` defaults to true for a stable change list; all action JSON envelopes ≤ 64KiB (contract assertion)

## Build and Test

```bash
# 构建（零依赖，仅需 monorepo 的 tsc）
node <monorepo>/node_modules/typescript/bin/tsc -p tsconfig.json

# 测试（vitest，124 个用例）
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

## npm 0.1.0-rc.8 Compatibility (Verified)

This plugin has been migrated to the npm 0.1.0-rc.8 dependency line and fully verified end-to-end in an isolated consumer of `@deepseek-ai/dsh@0.1.0-rc.8`:

- **Types/runtime**: `@deepseek-ai/cordis: ^4.0.1` + `@deepseek-ai/dsh-tools: >=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants: >=0.0.1-rc.1 <0.2.0` (peer); no longer depends on unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption verification**: tarball loaded into a 0.1.0-rc.8 consumer → `dsh --profile compat --dump-config` shows this plugin's row → the tool genuinely registers and executes
- **Launch method**: `npx -p @deepseek-ai/dsh@0.1.0-rc.8 dsh web` (lib production mode; don't `install -g` globally)


## Installation

### Profile Bundle (Recommended)

As of DSH 0.1.0-rc.8 (npm), this plugin can be installed into any profile as a standalone bundle in one step (repositories live at https://github.com/omdsh-dev, public):

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-diff
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-diff
```

You can also pack a tarball with `npm pack` first and install that:

```sh
git clone https://github.com/omdsh-dev/dsh-tool-diff
cd dsh-tool-diff
npm install && npm pack
dsh plugin --profile web add ./deepseek-ai-dsh-tool-diff-*.tgz
dsh plugin --profile headless add ./deepseek-ai-dsh-tool-diff-*.tgz
```

The in-package `dsh.bundle.patch` automatically adds the plugin to the profile's layer stack after installation (row id: `tool-diff`). The plugin's missing peer dependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-invariants`) are provided by the profile's healed `profiles/node_modules` fallback installation.

> ⚠️ web and headless are **different profiles**: installing for web doesn't automatically cover headless; `dsh run` uses the headless profile by default. Use forward slashes for Windows paths (`C:/...`).

### Verify Installation

```sh
dsh --profile web --dump-config | grep tool-diff
```

### Runtime Verification

```sh
dsh run "使用 diff 工具对比两段文本"
```

### Manual Installation (Source Contribution / Legacy Snapshot Scenarios)

Only for source contribution (developing/debugging this plugin in the monorepo) or scenarios still using old snapshots (local junction/symlink, manual profile-layer editing).

## License

MIT
