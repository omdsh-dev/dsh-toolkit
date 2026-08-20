# dsh-tool-stat

[中文](README.md)

DSH statistics tool plugin — descriptive statistics, percentiles, frequency distributions, correlation computation. Zero dependencies, pure functions, deterministic.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

When Agents process numeric data, after extracting numeric arrays from CSV / JSON they often need aggregate analysis (mean, quantiles, distributions, correlation). The existing toolchain has no such capability:

1. **`calculator` only does single-expression evaluation** — one expression cannot compute quantile distributions, let alone a correlation coefficient
2. **`dsh-tool-csv`'s `stats` only reports row/column structure** — it does not provide statistical aggregation over a set of observations
3. **Model "mental" statistics are not verifiable** — mean, variance, percentiles, and correlation involve a large amount of floating-point computation; manual calculation has an extremely high error rate and cannot show the user a reproducible process

This plugin accepts an explicitly passed finite numeric array or paired observations and provides deterministic statistical computation: a single function call returns a structured JSON report in milliseconds. It reads no files, accesses no network, spawns no processes, and stores no state — the same input always yields the same output.

## Security Model

- **Zero dependencies**: Neumaier compensated summation, Welford online variance, linear-interpolation percentiles, and Spearman midrank are all hand-written; no third-party numeric library
- **Strict finite-number constraint**: rejects `NaN` / `Infinity` (error messages locate the index, e.g. `values[3] must be a finite number (got Infinity)`); `-0` is normalized to `0` in both input and output
- **Overflow re-check**: all results are re-checked for finiteness before being returned; intermediate or final overflows return a `numeric-overflow` error — the canonical output **never** contains non-finite values
- **Pure functions**: input arrays are never mutated (read-only traversal; a copy is made first when sorting is needed)
- **Zero-variance semantics**: `correlation` on a zero-variance pair returns `defined: false` + `reason: "zero-variance"` instead of NaN or ±Infinity
- **Budgets**:
  - 1..100,000 observations (over-limit is rejected with an error immediately)
  - ≤ 100 percentile requests
  - ≤ 10,000 distinct outputs (beyond that, truncated by deterministic rules and flagged)
  - `timeoutMs: 2000`
- Tool parameters are recorded in the session log; do not pass sensitive data

## Tool Declaration

Registers the `stat` tool (`@deepseek-ai/dsh-tool-stat`, row id `tool-stat`), uniformly outputting a JSON text string.

| action | Purpose | Output |
|---|---|---|
| `describe` | Descriptive statistics | count / sum / min / max / mean / median / variance / standardDeviation / q1 / q3 / iqr (Neumaier compensated summation + Welford variance, population or sample) |
| `percentile` | Percentiles | One or more percentiles (linear interpolation `h=(n-1)*p`, `0..100`), output in request order, duplicates preserved |
| `frequency` | Frequency distribution | value / count / ratio groups (exact-equality grouping, ascending output, ratio denominator is the original count) |
| `correlation` | Correlation coefficient | Pearson or Spearman (midrank average rank) correlation coefficient; zero variance returns `defined:false` + `reason` |

| Parameter | Type | Required | Description |
|---|---|---|---|
| `action` | string | ✅ | `describe` / `percentile` / `frequency` / `correlation` |
| `values` | array<number> | ✅ | Finite numeric observations (1..100,000); `-0` normalized to `0` |
| `other` | array<number> | | Paired observations for correlation; length must equal `values` (≥2) |
| `percentiles` | array<number> | | Percentiles for percentile (`0..100`, 1..100 items) |
| `method` | string | | Correlation method: `pearson` (default) / `spearman` |
| `sample` | boolean | | Variance denominator: `true` uses sample (n-1), default `false` (population n) |

## Output Examples

```json
{"action":"describe","count":5,"sum":15,"min":1,"max":5,"mean":3,"median":3,"variance":2,
 "standardDeviation":1.4142135623730951,"q1":2,"q3":4,"iqr":2,"sample":false}
```

```json
{"action":"correlation","method":"pearson","count":4,"defined":true,"value":1,"reason":null}
```

## Design Points

- **Neumaier compensated summation**: `sum` uses a compensation term to correct rounding loss when adding large + small numbers; `variance` uses the Welford online algorithm (single-pass, numerically stable); describe and correlation share the same statistics core
- **Linear-interpolation percentiles**: `h=(n-1)*p`, `value = v[floor(h)] + (h - floor(h)) * (v[ceil(h)] - v[floor(h)])`; output keeps the request order, duplicate percentiles preserved
- **Spearman midrank**: ties take the average rank (midrank), then Pearson is computed on the ranks; pairs that are entirely identical do not affect boundedness
- **Zero-variance semantics**: when either series has zero variance, the correlation coefficient is undefined — returns `defined:false` + `reason:"zero-variance"`, never NaN/±Infinity
- **Frequency truncation rule**: when distinct outputs exceed 10,000, select the top 10,000 items by count descending → value ascending, then present them by value ascending (deterministic and reproducible)
- **Determinism**: no randomness, no state, no time dependence; floating-point operation order is fixed, the same input always yields the same output

## Build & Tests

```bash
# Build (zero dependencies, only needs the monorepo's tsc)
node <monorepo>/node_modules/typescript/bin/tsc -p tsconfig.json

# Tests (vitest, 82 cases: describe 20 / percentile 7 / frequency 7 / correlation 15 / limits 24 / register 9)
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

## npm 0.1.0-rc.8 Compatibility (Verified)

This plugin has been migrated to the npm 0.1.0-rc.8 dependency line and fully verified end-to-end in an isolated consumer of `@deepseek-ai/dsh@0.1.0-rc.8` (npm private package):

- **Types/runtime**: peers are `@deepseek-ai/cordis: ^4.0.1` + `@deepseek-ai/dsh-tools: >=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants: >=0.0.1-rc.1 <0.2.0`; no longer depends on the unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies are self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption verification**: tarball installed into a DSH 0.1.0-rc.8 (npm) consumer → `dsh --profile compat --dump-config` shows this plugin's row → tool registration and execution actually pass
- **Launch method**: `npx -p @deepseek-ai/dsh@0.1.0-rc.8 dsh web` (lib production mode; do not `install -g` globally)

## Installation

### Profile Bundle (Recommended)

Install this plugin into a profile as a standalone bundle (DSH 0.1.0-rc.8 (npm)). This repository lives under the [omdsh-dev](https://github.com/omdsh-dev) organization and is publicly accessible:

```sh
# Interactive (web) profile —— install from the GitHub repository
dsh plugin --profile web add github:omdsh-dev/dsh-tool-stat
# One-off task (headless) profile —— dsh run uses headless by default
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-stat
```

Or install from the tarball produced by `npm pack`:

```sh
npm pack     # produces dsh-tool-stat-<version>.tgz
# Interactive (web) profile
dsh plugin --profile web add ./dsh-tool-stat-<version>.tgz
# One-off task (headless) profile
dsh plugin --profile headless add ./dsh-tool-stat-<version>.tgz
```

The bundled `dsh.bundle.patch` automatically adds the plugin to the profile's layer stack after installation (row id: `tool-stat`). The plugin's missing peer dependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`, `@deepseek-ai/dsh-invariants`) are provided by the profile's healed `profiles/node_modules` fallback installation.

> ⚠️ web and headless are **different profiles**: installing into web does not automatically cover headless; `dsh run` uses the headless profile by default. Use forward slashes for Windows paths (`C:/...`).

### Verify Installation

```sh
dsh --profile web --dump-config | grep tool-stat
```

### Runtime Verification

```sh
dsh run "使用 stat 工具计算 [1,2,3,4,5] 的描述统计"
```

### Manual Installation and Legacy Compatibility (legacy monorepo scenario)

The monorepo way is only for legacy scenarios: old snapshots that do not support Profile Bundle, or plugin development/debugging environments (local junction/symlink, manually editing profile layers).

## License

MIT
