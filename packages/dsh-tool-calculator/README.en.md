# dsh-tool-calculator

[中文](README.md)

DSH Calculator tool plugin — a safe mathematical expression evaluator. Zero dependencies, zero processes, pure functions.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

Agents being unreliable at arithmetic is a common weakness of LLMs. DSH's built-in `bash` tool can call `echo $((15 + 27 * 3))` to do calculations, but it has two problems:

1. **Every arithmetic operation spawns a bash process** — especially expensive on Windows (process creation, shell loading, execution, output collection), with noticeable cumulative latency under high-frequency calls
2. **bash arithmetic syntax is limited** — it doesn't support math functions such as `sqrt`, `sin`, `cos`, `log`, `pow`; in these scenarios the agent can only guess the answer or write a script

This plugin provides a zero-dependency, zero-process, pure-function calculator — a single function call returns the result in milliseconds, covering common elementary math functions.

## Security Model

**No `eval`, no `new Function`.** It uses a hand-written recursive descent parser (lexer layer + parser layer), evaluating only whitelisted nodes:

- The lexer layer only recognizes numeric literals, whitelisted identifiers, and operators; quotes, semicolons, backticks, `{}` `[]` fail directly with an error
- Identifiers are looked up by name in the whitelist table (15 functions + 2 constants); anything not found throws `Unknown identifier`
- Evaluation results must be finite numbers; `NaN`/`Infinity` (division by zero, square root of a negative number, etc.) are uniformly rejected

`new Function` + regex whitelisting is **unsafe** — `constructor.constructor(...)` can reach the `Function` constructor directly and execute arbitrary code, and `process.exit(0)` can kill the host process outright (both reproduced in actual testing). This implementation uses no code-evaluation shortcuts.

## Architecture

```
┌──────────────────────────────┐
│         DSH Agent             │
│  tool call: calculator { ... }│
└──────────┬───────────────────┘
           │ ctx.tools.register()
┌──────────▼───────────────────┐
│     src/index.ts             │
│     Cordis 插件入口           │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│     src/evaluate.ts          │
│     tokenize() → parse()     │
│     递归下降解析器            │
└──────────────────────────────┘
```

- `src/index.ts`: Cordis plugin entry (`name`/`inject`/`apply`), registers the `calculator` tool
- `src/evaluate.ts`: `evaluate(expression: unknown): number` — the entry point independently validates the type (throws `calculator: expression must be a string` for non-strings), returns finite numbers, and throws on all invalid input

## Tool Declaration

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { evaluate } from './evaluate.ts'

export const name = '@deepseek-ai/dsh-tool-calculator'
export const inject = ['tools']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'calculator',
    description:
      'Evaluate a mathematical expression safely. ' +
      'Supports +, -, *, /, %, **, parentheses, and functions: ' +
      'abs, ceil, floor, round, max, min, sqrt, pow, log, log2, log10, exp, sin, cos, tan, PI, E.',
    parameters: {
      expression: {
        type: 'string',
        required: true,
        description: 'Mathematical expression, e.g. "15 + 27 * sqrt(9)"',
      },
    },
    output: {
      schema: { type: 'number' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    execute: async (args) => evaluate(args.expression),
    timeoutMs: 1000,
  }))
}
```

## Supported Operations

| Category | Items |
|------|------|
| Arithmetic | `+` `-` `*` `/` `%` `**` (power, right-associative: `2 ** 3 ** 2` = 512) |
| Functions (single arg) | `abs` `ceil` `floor` `round` `sqrt` `log` `log2` `log10` `exp` `sin` `cos` `tan` |
| Functions (multiple args) | `pow(x, y)` `max(a, b, ...)` `min(a, b, ...)` |
| Constants | `PI` `E` |
| Grouping | `(` `)`, unary plus/minus `+5` `-5` |

Precedence: `**` (right-associative) > unary `±` > `* / %` > `+ -`.

## DSH 0.1.2-rc.1 Compatibility (Verified)

This plugin has been migrated to the DSH 0.1.2-rc.1 harness and fully verified end-to-end in an isolated consumer of `local harness 0.1.2-rc.1`:

- **Types/runtime**: `@deepseek-ai/cordis: ^4.0.1` + `@deepseek-ai/dsh-tools: >=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants: >=0.0.1-rc.1 <0.2.0` (peer); no longer depends on unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption verification**: tarball loaded into a 0.1.2-rc.1 consumer → `dsh --profile compat --dump-config` shows this plugin's row → the tool genuinely registers and executes
- **Launch method**: `npx -p @deepseek-ai/dsh@next dsh web` (lib production mode; don't `install -g` globally)


## Version Adaptation

- **DSH adapted**: DSH 0.1.2-rc.1 (migration: profile/bundle plugin system)
- **bundle declaration**: `dsh.bundle` in `package.json` (patch points to `cordis.patch.yml`) + `exports` export
- **patch format**: `cordis.patch.yml` uses the `- insert:` list (the DSH 0.1.2-rc.1 patch is id-targeted semantics; a bare `- id:` entry reports `entry not found`)
- **files**: the published tarball contains `lib/`, `src/`, `cordis.patch.yml`

## Installation

### Profile Bundle (Recommended)

As of DSH 0.1.2-rc.1, this plugin can be installed into any profile as a standalone bundle in one step (repositories live at https://github.com/omdsh-dev, public):

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-calculator
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-calculator
```

You can also pack a tarball with `npm pack` first and install that:

```sh
git clone https://github.com/omdsh-dev/dsh-tool-calculator
cd dsh-tool-calculator
npm install && npm pack
dsh plugin --profile web add ./deepseek-ai-dsh-tool-calculator-*.tgz
dsh plugin --profile headless add ./deepseek-ai-dsh-tool-calculator-*.tgz
```

The in-package `dsh.bundle.patch` (pointing to `cordis.patch.yml`) automatically adds the plugin to the profile's layer stack after installation; the plugin's `cordis.patch.yml` inserts the `tool-calculator` entry via `- insert:`. The plugin's missing peer dependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-invariants`) are provided by the profile's healed `profiles/node_modules` fallback installation.

> ⚠️ web and headless are **different profiles**: installing for web doesn't automatically cover headless; `dsh run` uses the headless profile by default. Use forward slashes for Windows paths (`C:/...`).

### Verify Installation

```sh
dsh --profile web --dump-config | grep tool-calculator
```

### Runtime Verification

```sh
dsh run "使用 calculator 工具计算 1+2*3"
```

### Manual Installation (Source Contribution / Legacy Snapshot Scenarios)

For source contribution (developing/debugging this plugin in the monorepo) or for scenarios still using old snapshots:

1. Place it in the monorepo: `cp -r calculator ~/.dsh/source/master/packages/tools/calculator` (dev debugging)
2. Add `"@deepseek-ai/dsh-tool-calculator": "workspace:^"` to `apps/cli/package.json`; add `{ "path": "./packages/tools/calculator" }` to the `tsconfig.host.json` references
3. `pnpm install && pnpm run build`
4. Insert the plugin in the profile user-layer patch (`~/.dsh/profiles/<name>/cordis.patch.yml`):

```yaml
- insert:
    - id: tool-calculator
      name: '@deepseek-ai/dsh-tool-calculator'
```

5. Verify: `dsh --profile <name> --dump-config | grep tool-calculator`

> DSH 0.1.2-rc.1 note: the patch is id-targeted semantics — a bare `- id:` entry reports `entry "xxx" not found`; it must be wrapped in a `- insert:` list.
## Usage

After installation, the agent automatically gets the `calculator` tool:

```
calculator { expression: "15 + 27 * sqrt(9)" }  →  96
```

The tool name satisfies DeepSeek's function-name constraints (≤64 characters, `[A-Za-z0-9_-]`). After registration it automatically enters the Code Mode SDK (`await tools.calculator(...)`), and the canonical return value is a number.

## Known Limitations

1. **Distribution chain**: `@deepseek-ai/dsh-tools` is now published as a private npm package with DSH 0.1.2-rc.1; the plugin installs directly via `dsh plugin add github:omdsh-dev/...` or the tarball, with no need to place it in the monorepo for workspace resolution
2. **Trigonometric functions use radians**: consistent with `Math.sin`/`Math.cos`; write `sin(30 * PI / 180)` when you need degrees
3. **No big integers**: JS `number` is an IEEE 754 double; the safe integer range is ±9e15, beyond which precision is lost
4. **No scientific notation**: `1e5` is rejected by the lexer layer

## Testing

```bash
pnpm test
```

Includes functional test cases and attack-payload cases (`constructor.constructor` chain, `process.exit(0)`, `globalThis`, quote injection, semicolon statements, etc.). The complete case list is in the locally maintained design document.

## License

MIT
