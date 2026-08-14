# dsh-tool-csv

[中文](README.md)

DSH CSV data tool plugin — parse, query, filter, aggregate, and transform CSV text. Zero dependencies, pure functions, RFC 4180 state-machine parser.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

Tabular data (export files, API responses, report snippets) appears frequently in agent sessions. The existing path is to spawn a `bash` process and have the model write a parsing script on the fly:

1. **Every call spawns a process** — especially expensive on Windows
2. **Model-written CSV parsers have a high error rate** — hand-written code easily trips over edge cases like commas inside quotes, `""` escapes, BOM, multi-line fields, and CRLF, and the result can't be verified

This plugin provides deterministic, zero-dependency, pure-function CSV processing: a single function call returns structured JSON in milliseconds.

Together with `dsh-tool-json` it forms a "structured data processing" pair: JSON handles objects, CSV handles tables.

## Security Model

- **Zero dependencies**: no CSV parsing library; a hand-written state machine (single pass, O(n))
- **Pure functions**: no file reads, no file writes, no network, no eval
- **No injection surface**: query filtering only does literal exact matching (`===`), no expression evaluation
- **Budgets**: input capped at 256,000 bytes (errors directly beyond the limit, no truncation); `timeoutMs: 2000`; `limit` defaults to 100 rows to prevent output bloat
- Tool arguments are recorded in the session log; don't pass sensitive data

## Tool Declaration

Registers the `csv` tool (`@deepseek-ai/dsh-tool-csv`, row id `tool-csv`), uniformly outputting JSON text strings.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | `parse` / `query` / `stats` / `to_json` |
| `csv` | string | ✅ | CSV text (RFC 4180; quoted fields may contain commas/newlines; `""` escapes; BOM ignored) |
| `column` | string | | Query column: column name (when there's a header) or a 1-based index such as `"2"` |
| `value` | string | | Exact-match value for query (strict equality, not substring) |
| `delimiter` | string | | Delimiter, default `","`; a single character or `"tab"` |
| `header` | boolean | | Whether the first row is a header, default `true`; when `false`, rows are parsed as arrays |
| `limit` | integer | | Max number of returned rows (query/parse), default 100 |

## Actions

| action | Function | Example output |
|---|---|---|
| `parse` | Parse into a JSON array (one object per row when there's a header) | `[{"name":"Alice","city":"NYC"}]` |
| `query` | Exactly filter rows by column name/index (result includes the header and can be read back) | `[["name","city"],["Alice","NYC"]]` |
| `stats` | Row count / column count / column names / empty-row count / warnings (including duplicate column names, inconsistent field counts) | `{"rows":2,"columns":2,...}` |
| `to_json` | Alias of `parse` (model-friendly) | Same as `parse` |

## Examples

```
csv { action: "parse", csv: "name,city\nalice,nyc\nbob,la" }
  → [{"name":"alice","city":"nyc"},{"name":"bob","city":"la"}]

csv { action: "query", csv: "name,city\nalice,nyc\nbob,la", column: "city", value: "la" }
  → [["name","city"],["bob","la"]]

csv { action: "stats", csv: "name,city\nalice,nyc" }
  → {"rows":1,"columns":2,"columnNames":["name","city"],"emptyRows":0,"warnings":[]}
```

## Edge-Case Behavior

| Situation | Handling |
|---|---|
| Comma/newline/CRLF inside quotes | Treated as field content (multi-line fields) |
| `""` escape | Decoded to a single `"` |
| **Unclosed quote** | **Error**: `csv: unterminated quoted field` (strict mode, no silent tolerance) |
| **Invalid character after closing quote** | **Error**: `csv: invalid character "x" after closing quote` (RFC 4180: only a delimiter/newline/EOF is allowed after the closing quote) |
| BOM in the first row | Stripped before parsing |
| Empty rows | Skipped (stats reports the empty-row count) |
| Inconsistent field counts | No error: missing fields are padded with `null`, extras are merged into the last field (stats records a warning) |
| Duplicate column names | The later column overrides the earlier one (stats records a warning) |
| **`__proto__`/`constructor`/`prototype` headers** | Written into a null-prototype object, **lossless serialization** (`{"__proto__":"value"}`) |
| delimiter | Only a single UTF-16 code unit or `"tab"`; surrogate pairs (e.g. `😀`) and control characters (except `\t`) are rejected |
| No header | `header: false`, rows are parsed as arrays, `column` uses 1-based indexes |
| Input over 256KB | Errors directly (no truncation) |
| Hundred-thousand-row input | Single-pass aggregation computes column widths (no spread), no RangeError |

## npm 0.1.0-rc.6 Compatibility (Verified)

This plugin has been migrated to the npm 0.1.0-rc.6 dependency line and fully verified end-to-end in an isolated consumer of `@deepseek-ai/dsh@0.1.0-rc.6`:

- **Types/runtime**: `@deepseek-ai/cordis: ^4.0.1` + `@deepseek-ai/dsh-tools: >=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants: >=0.0.1-rc.1 <0.2.0` (peer); no longer depends on unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption verification**: tarball loaded into a 0.1.0-rc.6 consumer → `dsh --profile compat --dump-config` shows this plugin's row → the tool genuinely registers and executes
- **Launch method**: `npx -p @deepseek-ai/dsh@0.1.0-rc.6 dsh web` (lib production mode; don't `install -g` globally)


## Installation

### Profile Bundle (Recommended)

As of DSH 0.1.0-rc.6 (npm), this plugin can be installed into any profile as a standalone bundle in one step (repositories live at https://github.com/omdsh-dev, public):

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-csv
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-csv
```

You can also pack a tarball with `npm pack` first and install that:

```sh
git clone https://github.com/omdsh-dev/dsh-tool-csv
cd dsh-tool-csv
npm install && npm pack
dsh plugin --profile web add ./deepseek-ai-dsh-tool-csv-*.tgz
dsh plugin --profile headless add ./deepseek-ai-dsh-tool-csv-*.tgz
```

The in-package `dsh.bundle.patch` automatically adds the plugin to the profile's layer stack after installation (row id: `tool-csv`). The plugin's missing peer dependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-invariants`) are provided by the profile's healed `profiles/node_modules` fallback installation.

> ⚠️ web and headless are **different profiles**: installing for web doesn't automatically cover headless; `dsh run` uses the headless profile by default. Use forward slashes for Windows paths (`C:/...`).

### Verify Installation

```sh
dsh --profile web --dump-config | grep tool-csv
```

### Runtime Verification

```sh
dsh run "使用 csv 工具解析 'a,b
1,2'"
```

### Manual Installation (Source Contribution / Legacy Snapshot Scenarios)

Only for source contribution (developing/debugging this plugin in the monorepo) or scenarios still using old snapshots (local junction/symlink, manual profile-layer editing).
## Testing

```bash
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

- `parse.spec.ts`: RFC 4180 edge cases (quotes/escapes/BOM/CRLF/empty rows/tab/size caps/strict quote errors/delimiter validation)
- `query.spec.ts`: column name/index filtering, exact matching, limit, error paths, stats warnings, JSON mapping, dangerous headers, 125k-row stress
- `register.spec.ts`: registration contract (AUDIT-CROSS-02 style)

## License

MIT
