# dsh-tool-regex

[中文](README.md)

DSH regex tool plugin — test matches, extract capture groups, safe replacement, and **statically explain the meaning of a regex (without executing any code)**. Zero dependencies, pure functions.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

Models often need to validate a user-provided pattern, extract fields from logs/text, and perform text replacement. "Mental" regex evaluation has an extremely high error rate and cannot show the user a verifiable process. The existing alternative is to spawn a `bash` process to run `node -e` or python — process overhead plus the correctness risk of scripts the model writes on the fly. The built-in `grep` only supports **file-scoped** search; it cannot test/extract/replace/explain on arbitrary text.

This plugin provides deterministic regex tools, of which `explain` is the differentiating capability: it statically parses the pattern structure and returns a human-readable explanation, **without executing the match**, making it inherently immune to ReDoS.

## Security Model (Multi-layered ReDoS Defense)

Catastrophic backtracking in JS regex is a real threat (e.g. `(a+)+$` combined with a very long input). Defenses:

1. **Worker hard timeout**: test/find/replace run synchronously inside a **terminable worker thread**; when the 1,000ms budget expires, `worker.terminate()` is called and `regex: execution timed out` is returned — catastrophic backtracking can no longer block the host process (the tool pipeline's `timeoutMs` is cooperative for a synchronous blocking body and is insufficient on its own; all limit checks are re-executed inside the worker)
2. **Input length cap**: 64,000 bytes (UTF-8) — over-limit inputs are rejected at the entry point and never enter backtracking
3. **Resource caps**: pattern ≤ 16KB, replacement ≤ 16KB, output ≤ 1MB, match count ≤ 1,000 (clamped by limit)
4. **explain executes nothing**: only a static tokenizer; no `RegExp` instance is constructed, so any pattern returns immediately

> ⚠️ Both the tool description and this README explicitly warn the model: **do not use unanchored nested-quantifier patterns** (such as `(a+)+`, `(.*)*`) **on untrusted large inputs**.

Other boundaries: invalid patterns are caught and reported as `SyntaxError` (including position info); invalid/duplicate flags are validated character by character; `replace` uses the `String.replace` **string replacement path** (native JS `$` semantics, no `new Function`, no eval).

## Tool Declaration

Registers the `regex` tool (`@deepseek-ai/dsh-tool-regex`, row id `tool-regex`), uniformly outputting a JSON text string.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | `test` / `find` / `replace` / `explain` |
| `pattern` | string | ✅ | Regex (JavaScript syntax, **without** surrounding `/`); ≤ 16KB |
| `input` | string | | Text to match (required for test/find/replace); ≤ 64KB |
| `flags` | string | | e.g. `"gi"`; supports `g i m s u y d v`, must be unique and valid |
| `replacement` | string | | Replacement text for replace, supports `$1`/`$2`/`$<name>`/`$$`; ≤ 16KB |
| `limit` | integer | | Max number of matches reported by find, default 50, **cap 1,000** |

## Actions

| action | Function | Output example |
|---|---|---|
| `test` | Determine whether it matches (whole-string semantics are expressed by the model itself via `^...$`) | `{"matched":true}` |
| `find` | All matches: index / full match / **numbered capture groups `captures`** / named groups `groups` (**auto-adds `g` when absent**) | `[{"index":0,"match":"a@b","captures":["a","b"],"groups":{"name":"a"}}]` |
| `replace` | Global safe replacement (`$1`/`$<name>`/`$$`), returns the result and the replacement count | `{"result":"world hello","replaced":1}` |
| `explain` | Statically parse the pattern → human-readable node sequence (no match executed; node count ≤ 4,096) | `[{"kind":"escape","text":"\\d","meaning":"A digit [0-9]"}]` |

## Examples

```
regex { action: "find", pattern: "(\\w+)@(\\w+)", input: "a@b x c@d" }
  → [{"index":0,"match":"a@b","captures":["a","b"],"groups":null},{"index":6,"match":"c@d","captures":["c","d"],"groups":null}]

regex { action: "replace", pattern: "(\\w+) (\\w+)", input: "hello world", replacement: "$2 $1" }
  → {"result":"world hello","replaced":1}

regex { action: "explain", pattern: "\\d{4}-\\d{2}" }
  → [{"kind":"escape","text":"\\d","meaning":"A digit [0-9]"},{"kind":"quantifier","text":"{4}",...},...]
```

## Edge Cases

| Case | Handling |
|---|---|
| Invalid pattern | `regex: invalid pattern: <SyntaxError message (with position)>`, no crash |
| Invalid / duplicate flag | `regex: invalid flag "q"` / `regex: duplicate flag "g"` |
| Empty pattern | Valid (matches the empty string); under `u`/`v`, empty matches advance by code point (surrogate pairs are not matched twice) |
| ReDoS (pathological pattern) | Worker hard timeout: `regex: execution timed out (1000ms)`, host not blocked |
| Named / numbered groups | find outputs `groups: {name: value}` and `captures: [...]`; replace supports `$<name>`/`$n` |
| Zero matches | find returns `[]`; replace returns the original text + `replaced: 0` |
| Input over 64KB / pattern over 16KB / replacement over 16KB | Rejected at the entry point (not truncated) |
| Output over 1MB (replacement expansion such as `$`` / `$'`) | `regex: result/output exceeds 1000000 bytes`, rejected rather than truncated |
| find limit | Default 50, clamped to 1,000 (prevents output bloat) |
| explain nodes over 4,096 | `regex: explain: pattern too complex` |
| `$` references | Go through the native JS string replacement path: `$$`→`$`, `$n`→group (empty string if not matched), `$<name>`→named group, unknown references kept literally (`$0`/`$<foo>` consistent with V8) |

## npm 0.1.0-rc.6 Compatibility (Verified)

This plugin has been migrated to the npm 0.1.0-rc.6 dependency line and fully verified end-to-end in an isolated consumer of `@deepseek-ai/dsh@0.1.0-rc.6` (npm private package):

- **Types/runtime**: peers are `@deepseek-ai/cordis: ^4.0.1` + `@deepseek-ai/dsh-tools: >=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants: >=0.0.1-rc.1 <0.2.0`; no longer depends on the unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies are self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption verification**: tarball installed into a DSH 0.1.0-rc.6 (npm) consumer → `dsh --profile compat --dump-config` shows this plugin's row → tool registration and execution actually pass
- **Launch method**: `npx -p @deepseek-ai/dsh@0.1.0-rc.6 dsh web` (lib production mode; do not `install -g` globally)

## Installation

### Profile Bundle (Recommended)

Install this plugin into a profile as a standalone bundle (DSH 0.1.0-rc.6 (npm)). This repository lives under the [omdsh-dev](https://github.com/omdsh-dev) organization and is publicly accessible:

```sh
# Interactive (web) profile —— install from the GitHub repository
dsh plugin --profile web add github:omdsh-dev/dsh-tool-regex
# One-off task (headless) profile —— dsh run uses headless by default
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-regex
```

Or install from the tarball produced by `npm pack`:

```sh
npm pack     # produces dsh-tool-regex-<version>.tgz
# Interactive (web) profile
dsh plugin --profile web add ./dsh-tool-regex-<version>.tgz
# One-off task (headless) profile
dsh plugin --profile headless add ./dsh-tool-regex-<version>.tgz
```

The bundled `dsh.bundle.patch` automatically adds the plugin to the profile's layer stack after installation (row id: `tool-regex`). The plugin's missing peer dependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`) are provided by the profile's healed `profiles/node_modules` fallback installation.

> ⚠️ web and headless are **different profiles**: installing into web does not automatically cover headless; `dsh run` uses the headless profile by default. Use forward slashes for Windows paths (`C:/...`).

### Verify Installation

```sh
dsh --profile web --dump-config | grep tool-regex
```

### Runtime Verification

```sh
dsh run "使用 regex 工具测试 d+ 是否匹配 abc123"
```

### Manual Installation and Legacy Compatibility (legacy monorepo scenario)

The monorepo way is only for legacy scenarios: old snapshots that do not support Profile Bundle, or plugin development/debugging environments (local junction/symlink, manually editing profile layers).

## Tests

```bash
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

- `engine.spec.ts`: all branches of test/find/replace + flags/pattern errors + 64KB cap + **ReDoS worker cases** (pathological patterns are cancelled within the 3s budget without hanging the test process)
- `explain.spec.ts`: literals/character classes/groups/quantifiers/escapes/anchors/alternation + unterminated errors
- `register.spec.ts`: registration contract (AUDIT-CROSS-02 style)

## License

MIT
