# dsh-tool-schema

[中文](README.md)

DSH JSON Schema validation tool plugin — validate data, list failing paths, explain schema constraints, and safely apply defaults. Zero network, zero dynamic code execution.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

Agents need to validate arbitrary JSON data against a schema (API response structures, plugin manifests, config files, session events) and locate failing paths. Existing paths lack this capability:

1. **The `defineTool` parameter DSL is an author DSL** — it targets plugin authors declaring tool parameters, not a general-purpose validation service for arbitrary user schemas
2. **`dsh-tool-json` only offers querying** — it can fetch paths and filter, but it does not validate structure or provide RFC 6901 failure location
3. **Model "eyeball" validation is unreliable** — with complex nested schemas (allOf/oneOf/`$ref`/pattern) combined, hand-computing pass/fail is highly error-prone and cannot show a verifiable process

This plugin provides an independent pure-function JSON Schema validation kernel: one function call returns the verdict, path-based errors, and schema issues. It executes no code, accesses no network, and **never silently ignores unsupported schema keywords**.

## Security Model

- **Zero dynamic execution**: the validation kernel is a pure data traversal — it does not construct `RegExp` (patterns run inside a separate worker), no `eval`, no network access, no file reads
- **Unsupported keywords are never silently ignored**: reports an `unsupported-keyword` schema issue; with `strictSchema=true` (default) it fails outright (`valid:false` / `complete:false`), with `strictSchema=false` it validates the supported subset (`valid:null` / `complete:false` / `supportedSubsetValid`)
- **ReDoS defense**: all `pattern` checks share a 1,000 ms hard budget inside a **terminable worker thread**; on timeout it calls `terminate()` and reports an error — catastrophic backtracking cannot block the host process; patterns ≤ 16 KiB, ≤ 100 per schema
- **Prototype pollution protection**: all object access uses `Object.hasOwn`; `__proto__` / `constructor` / `prototype` are treated only as ordinary JSON keys
- **`$ref` safety**: only local references are supported (`#` and `#/$defs/<token>`, RFC 6901 escaping); the target must exist; cycle detection (schema-check statically reports `ref-cycle` + a dynamic `(schemaNode, instance)` stack fallback at validation time)
- **Budgets**:
  - data / schema each ≤ 256 KiB (over the limit reports an error directly)
  - nesting depth ≤ 64, schema nodes ≤ 10,000, traversal nodes ≤ 100,000
  - errors 100 (default) / 1,000 (max); `$ref` chains ≤ 64
  - canonical output ≤ 1 MiB (on overflow, errors/schemaIssues etc. are truncated and `truncated` is set)
- Tool parameters are recorded in the session log — do not pass sensitive data

## Tool Declaration

Registers the `schema` tool (`@deepseek-ai/dsh-tool-schema`, row id `tool-schema`), uniformly emitting JSON text strings.

| action | Purpose | Output |
|---|---|---|
| `validate` | Validate whether the instance conforms to the schema | verdict + RFC 6901 `instancePath`/`schemaPath` errors (stable ordering) + `schemaIssues` + `checkedNodes` + `truncated` |
| `paths` | Return only failing paths | `paths` (path + keyword summary) + `errorCount` + `truncated` |
| `explain` | Statically explain schema constraints | a sequence of constraint-tree nodes (`nodes`, a finite list rather than long-form natural language) + `schemaIssues` + `truncated` |
| `normalize` | Deep copy + apply explicit `default`s, then validate | `appliedDefaults` (path + value) + `warnings` (`default-invalid` / `normalize-skip-branch`) + the full validate result |

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | `validate` / `paths` / `explain` / `normalize` |
| `data` | json | | The instance to validate (required for validate/paths/normalize; `null` is valid data) |
| `schema` | json | ✅ | JSON Schema (boolean or object; draft 2020-12 subset) |
| `strictSchema` | boolean | | Fail on unsupported keywords. Default `true` |
| `maxErrors` | integer | | Maximum number of errors to report. Default 100, range 1..1,000 |

Supported keywords: `type`/`enum`/`const`, objects (required/properties/additionalProperties/minProperties/maxProperties), arrays (items/minItems/maxItems/uniqueItems), strings (minLength/maxLength/pattern), numbers (minimum/maximum/exclusive\*/multipleOf), combinators (allOf/anyOf/oneOf/not), local `$ref`.

## Example Output

```json
{"action":"validate","complete":true,"valid":true,"supportedSubsetValid":true,
 "errors":[],"schemaIssues":[],"checkedNodes":3,"truncated":false}
```

```json
{"action":"paths","valid":false,"paths":[{"path":"/a","keywords":["type"]}],
 "errorCount":1,"truncated":false}
```

```json
{"action":"normalize","valid":true,
 "appliedDefaults":[{"path":"/b","value":5}],"warnings":[]}
```

## Design Points

- **Error format**: `instancePath` / `schemaPath` (RFC 6901 JSON Pointer), `keyword`, stable `code`, `message` (+ `expected`/`actual`); stable ordering: instancePath → schemaPath → keyword lexicographic
- **Combinator keywords**: when all anyOf/oneOf branches fail, the top-level error plus a bounded `branches` summary (≤ 3 per branch) is returned; oneOf with 0 / multiple matching branches reports `one-of` / `one-of-multiple` respectively; `not` fails when its sub-schema validates
- **Number semantics**: JSON numbers must be finite; integers use `Number.isInteger`; `multipleOf` uses a scaling/tolerance strategy (relative tolerance `1e-9`) rather than `% === 0`, with no arbitrary-precision promise
- **String length**: counted by Unicode code points; patterns run in a terminable worker sharing a 1,000 ms total budget
- **`$ref` semantics**: pure `$ref` cycles are statically reported by schema-check; `$ref` with sibling keywords takes effect together per draft 2020-12 (no 2019-09 sibling-ignoring behavior for `$ref`)
- **normalize does not overstep**: it never mutates input (all new objects use `Object.create(null)`); it only applies **explicit** `default`s for fields missing under `properties`; the default must be JSON-compatible and pass the corresponding sub-schema (otherwise a `default-invalid` warning and skip); no type coercion, no deletion of additional properties; oneOf/anyOf is entered only when exactly one branch already matches without applying defaults (otherwise a `normalize-skip-branch` warning)
- **explain is not silent**: the output carries `schemaIssues`; unsupported keywords are reported under explain as well
- **Reproducible output**: errors and issues are stably ordered; overflow truncation sets `truncated`; canonical output ≤ 1 MiB (contract assertion)

## Build & Test

```bash
# 构建（零依赖，仅需 monorepo 的 tsc）
node <monorepo>/node_modules/typescript/bin/tsc -p tsconfig.json

# 测试（vitest，125 个用例：scalar/object/array/combinators/ref/pattern/normalize/limits/register）
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

## npm 0.1.0-rc.8 Compatibility (Verified)

This plugin has been migrated to the npm 0.1.0-rc.8 dependency line and fully validated end-to-end in an isolated consumer of `@deepseek-ai/dsh@0.1.0-rc.8`:

- **Type/runtime**: `@deepseek-ai/cordis@^4.0.1` + `@deepseek-ai/dsh-tools@>=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants@>=0.0.1-rc.1 <0.2.0` (peer); no longer depends on unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption validation**: the tarball is installed into a 0.1.0-rc.8 consumer → `dsh --profile compat --dump-config` shows this plugin's row → the tool actually registers and executes successfully
- **Launch method**: `npx -p @deepseek-ai/dsh@0.1.0-rc.8 dsh web` (lib production mode; do not `install -g` globally)

## Installation

### Profile Bundle (Recommended)

The repository lives at [omdsh-dev/dsh-tool-schema](https://github.com/omdsh-dev/dsh-tool-schema) (public). Install this plugin as a standalone bundle into a profile (DSH 0.1.0-rc.8 (npm)):

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-schema
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-schema
```

The `dsh.bundle.patch` inside the package automatically adds the plugin to the profile's layer stack after installation (row id: `tool-schema`). Missing peer dependencies of the plugin (`cordis`, `@deepseek-ai/dsh-tools`) are provided by the profile's healed `profiles/node_modules` fallback install.

> ⚠️ web and headless are **different profiles**: installing to web does not automatically cover headless; `dsh run` uses the headless profile by default. Windows paths use forward slashes (`C:/...`).

### Installing from an npm pack Tarball

Build locally and install from the tarball path (no GitHub dependency):

```sh
# tarball method (web shown; headless same)
npm pack
dsh plugin --profile web add <path to the npm pack tarball>
```

### Verify Installation

```sh
dsh --profile web --dump-config | grep tool-schema
```

### Runtime Verification

```sh
dsh run "用 schema 工具验证 {name: 'x', age: 3} 是否符合给定 JSON Schema"
```

### Manual Installation & Legacy Compatibility

Legacy scenarios: monorepo integration, legacy snapshots that do not support Profile Bundle, or plugin development/debugging environments (local junction/symlink, manually editing profile layers).

## License

MIT
