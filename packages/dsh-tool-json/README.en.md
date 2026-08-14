# dsh-tool-json

[中文](README.md)

DSH JSON query tool plugin — JMESPath-inspired path queries (custom subset) with a zero-dependency recursive-descent parser.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why

Handling JSON is a high-frequency operation for agents — API return values, config files, and tool outputs are JSON everywhere. The current approach spawns a bash subprocess to run `node -e` or `jq`, incurring subprocess overhead and string serialization costs every time.

DSH's built-in `grep` can do regex matching but cannot understand JSON structure. For `{"items":[{"id":1}]}`:

- `grep` only does string-level search, easily false-matching values, keys, or same-named keys in nested sub-objects
- `json` follows structured paths, matching only the specified path without confusing keys and values

## Security model

Hand-written recursive-descent parser, no `eval`/`new Function`; `Object.hasOwn` prevents prototype-chain pollution (reading `constructor`/`__proto__` does not trigger the prototype chain). Resource limits (**uniformly enforced across both the object and string input paths**):

- Query expression length ≤ 200 characters, parse depth ≤ 20 levels, array indices must be safe integers
- String input ≤ 1,000,000 bytes (UTF-8); input nesting depth ≤ 100
- Single wildcard projection ≤ 100,000 elements
- Only accepts JSON-compatible values (null/boolean/finite number/string/array/plain object; rejects undefined/BigInt/functions/Date/non-finite numbers)

Error classification (`JsonQueryError`): `MISSING_PROPERTY` (skipped inside projections), `TYPE_MISMATCH`/`INDEX_OUT_OF_BOUNDS`/`INVALID_QUERY` (thrown as-is), all with a unified `json:` prefix.

> Cost model (AUDIT-JSON-03): input undergoes **full validation** (type/depth/bytes/cycles/enumerability) before every query — this is an intentional security cost; even querying a small field fully scans the input; `timeoutMs` cannot interrupt the synchronous validation.

## Architecture

```
DSH Agent
    │ ctx.tools.register()
    ▼
src/index.ts（Cordis 插件入口 + action 分发）
    │
    ▼
src/query.ts
    ├── parseQuery() — 递归下降解析器（strict 语法 + 转义 + 上限）
    ├── executeQuery() — 执行器（错误分类 + 投影上限）
    └── normalizeInput() — 双形态输入 + assertJsonCompatible 校验
```

## Tool declaration

```ts
ctx.tools.register(defineTool({
  name: 'json',
  parameters: {
    input: { type: 'json', required: true, description: 'JSON value or JSON string to query.' },
    query: { type: 'string', required: true, description: 'Path expression, e.g. "data.items[0].name".' },
  },
  output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
  execute: (args) => Promise.resolve(executeAction(args) as JsonValue),
  timeoutMs: 1000,
}))
```

`input` has two forms: an object passed directly (the model generates the argument directly, zero escaping) or a string (raw passthrough from bash/read); `normalizeInput` unifies normalization and validation.

## Query syntax (JMESPath-inspired subset)

| expression | example | description |
|--------|------|------|
| Dot access | `foo.bar` | Nested object property (identifier charset `[A-Za-z0-9_$` + BMP non-ASCII) |
| Bracket index | `items[0]` | Array index (safe integer) |
| Bracket property | `items['key']` / `items["key"]` | Property names containing special characters |
| Wildcard projection | `items[*].name` | **Arrays only**; extracts element properties |
| Composition | `a.b[0].c.d` | Any combination of the above |

**Semantic boundaries** (intentionally incompatible with standard JMESPath, locked):

- Multi-level wildcards like `items[*].tags[*]` return **nested arrays** (`[['a','b'],['c']]`) without standard projection flattening
- Wildcards apply to arrays only; object field enumeration is not supported; non-object elements are skipped per projection semantics; legal `null` results are **preserved**
- Quoted properties support three escapes `\\` `\'` `\"` (usable under any quoting form); illegal escapes error
- Only `MISSING_PROPERTY` is skipped inside projections; type/index/internal errors are thrown as-is

**Not supported** (low-frequency scenarios; fall back to bash + node): filters `[?downloads > 1000]`, pipes `|`, function calls.

## npm 0.1.0-rc.6 compatibility (verified)

This plugin has been migrated to the npm 0.1.0-rc.6 dependency line and fully verified in an isolated consumer of `@deepseek-ai/dsh@0.1.0-rc.6`:

- **Types/runtime**: `@deepseek-ai/cordis@^4.0.1` + `@deepseek-ai/dsh-tools@>=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants@>=0.0.1-rc.1 <0.2.0` (peer); no longer depends on unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies are self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption verification**: tarball installed into the 0.1.0-rc.6 consumer → `dsh --profile compat --dump-config` shows this plugin's row → the tool actually registers and executes
- **Startup**: `npx -p @deepseek-ai/dsh@0.1.0-rc.6 dsh web` (lib production mode; do not `install -g` globally)


## Version adaptation

- **DSH version adapted**: DSH 0.1.0-rc.6 (npm)
- **Bundle declaration**: `dsh.bundle` in `package.json` (patch points to `cordis.patch.yml`) + `exports` fields
- **Patch format**: `cordis.patch.yml` uses the `- insert:` list (patches are id-targeted; a bare `- id:` entry reports `entry not found`)
- **files**: the published tarball contains `lib/`, `src/`, `cordis.patch.yml`

## Installation

Plugin source repository: `https://github.com/omdsh-dev/dsh-tool-json` (public).

### Profile Bundle (recommended)

Install this plugin as a standalone bundle into a profile (DSH 0.1.0-rc.6, npm):

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-json
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-json
```

The `dsh.bundle.patch` inside the package (pointing to `cordis.patch.yml`) automatically adds the plugin to the profile's layer stack after installation; the plugin's `cordis.patch.yml` inserts the `tool-json` entry via `- insert:`.

> ⚠️ web and headless are **different profiles**: installing into web does not automatically cover headless; `dsh run` uses the headless profile by default.

### Install via npm pack tarball

```sh
npm pack    # generates dsh-tool-json-*.tgz
dsh plugin --profile web add ./dsh-tool-json-*.tgz
dsh plugin --profile headless add ./dsh-tool-json-*.tgz
```

### Verify installation

```sh
dsh --profile web --dump-config | grep tool-json
```

### Run verification

```sh
dsh run "使用 json 工具查询 {"a":{"b":1}} 的 a.b"
```

### Manual installation and legacy compatibility

Only for legacy snapshots that do not support Profile Bundle, or plugin development/debugging environments:

1. Place into the monorepo: `cp -r json ~/.dsh/source/master/packages/tools/json` (development/debugging)
2. Add `"@deepseek-ai/dsh-tool-json": "workspace:^"` to `apps/cli/package.json`; add `{ "path": "./packages/tools/json" }` to the `references` of `tsconfig.host.json`
3. `pnpm install && pnpm run build`
4. Insert the plugin in the profile's user-layer patch (`~/.dsh/profiles/<name>/cordis.patch.yml`):

```yaml
- insert:
    - id: tool-json
      name: '@deepseek-ai/dsh-tool-json'
```

5. Verify: `dsh --profile <name> --dump-config | grep tool-json`

> Note: patches are id-targeted — a bare `- id:` entry reports `entry "xxx" not found`; it must be wrapped in an `- insert:` list.
## Usage

```
json { input: <JSON>, query: "items[0].name" }        → "hello"
json { input: <JSON>, query: "items[*].name" }         → ["a", "b"]（合法 null 保留）
json { input: <JSON>, query: "items['complex-key']" }  → "ok"
```

## Known limitations

1. Read-only: cannot modify JSON fields (use `str_replace_editor`/`write` for in-place edits; a `set` mode may be considered for v2)
2. No filter expressions, no standard JMESPath projection flattening (see semantic boundaries)
3. Object-form input relies on the DSH parameter pipeline to guarantee lossless JSON

## Testing

```bash
pnpm test
```

54 test cases (functionality, errors, attack payloads, object/string dual-form inputs, resource limits, and escaping boundaries). See the locally maintained design document for the full list.

## License

MIT
