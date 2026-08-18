# dsh-tool-time

[中文](README.md)

DSH time tool plugin — strict ISO parsing, IANA timezone conversion, UTC calendar arithmetic, fixed-duration diffs. Zero dependencies, zero processes, pure functions.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Motivation

Handling time information is one of the most frequent Agent needs — "what time is it now", "what date is 3 days from now", "convert UTC to Beijing time". Problems with the current `bash date` approach: a process is spawned every time, cross-platform syntax is inconsistent (macOS and GNU `date -d` are completely different), and timezone conversion relies on hand-stitching `TZ=...`. Mentally computing timezone offsets and leap-year/DST boundaries is a high-error area for models.

## Security Model

No `eval`, no `new Function`. Input only passes through strict validation:

- **Strict ISO 8601 subset**: only accepts `YYYY-MM-DD` (UTC midnight), `YYYY-MM-DDTHH:mm:ssZ`, `YYYY-MM-DDTHH:mm:ss±HH:MM` (within ±14:00, optional `.SSS` milliseconds); datetimes without a timezone, RFC 2822, and natural-language dates are all rejected; calendar overflow such as `2026-02-30` is rejected by table-lookup validation (not relying on Date's silent normalization)
- **Timezone names**: IANA names are validated via `Intl.DateTimeFormat`; invalid ones throw `time: unknown timezone`
- **Numbers**: `amount` must be a safe integer; `unit` is an enumerated whitelist; all strings ≤ 200 characters
- **Fixed Intl environment**: `'en-CA'` + `hourCycle: 'h23'` (avoids midnight `24:00` and localized numerals)

## Architecture

```
DSH Agent
    │ ctx.tools.register()
    ▼
src/index.ts（Cordis 插件入口 + action 分发 + 独立校验）
    │
    ▼
src/time.ts
    ├── parseStrictISO() — 严格 ISO 解析（正则 + 查表校验）
    ├── formatInTimezone() — Intl formatToParts 组装（时钟可注入）
    ├── addMonthsClamped() — 先置 1 日 → 目标年月 → 天数钳制
    └── diffBetween() — 固定时长（sign + absolute 分解）
```

## Tool Declaration

```ts
ctx.tools.register(defineTool({
  name: 'time',
  parameters: {
    action: { type: 'string', required: true, enum: ['now', 'convert', 'add', 'diff'] },
    value:  { type: 'string', description: 'Strict ISO 8601 timestamp' },
    timezone: { type: 'string', description: 'IANA timezone (default UTC; display only)' },
    from:   { type: 'string', description: 'diff start' },
    to:     { type: 'string', description: 'diff end' },
    amount: { type: 'integer', description: 'Signed safe integer' },
    unit:   { type: 'string', enum: ['seconds','minutes','hours','days','weeks','months','years'] },
  },
  output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v, null, 2) }] },
  execute: (args) => Promise.resolve(executeAction(args.action, args) as JsonValue),
  timeoutMs: 1000,
}))
```

## Supported Operations

| action | Parameters | Returns |
|--------|------|------|
| `now` | `timezone?` (default UTC) | Structured representation of the current time |
| `convert` | `value` + `timezone` (required) | Converted structured time |
| `add` | `value` + `amount` + `unit` (`timezone?` display only) | Structured time after addition/subtraction |
| `diff` | `from` + `to` | Fixed-duration diff (no months/years) |

Return structure (canonical value):

```json
{
  "iso": "2026-08-05T06:00:00.000Z",
  "unix": 1785909600000,
  "timezone": "Asia/Shanghai",
  "timezoneSource": "explicit",
  "local": "2026-08-05T14:00:00+08:00",
  "formatted": "2026-08-05 14:00:00 (Asia/Shanghai)"
}
```

Semantic contract:

- **`add` always operates in UTC** (calendar-day semantics; keeps the "calendar day" intuition across DST); `timezone` only determines the `local`/`formatted` display
- **Month/year clamping**: `2026-01-31 + 1 month = 2026-02-28`; `2028-02-29 + 1 year = 2029-02-28` (set to day 1 → locate the target year/month → clamp to the target month's max days)
- **`diff` is fixed-duration only**: `sign` + signed total + `absolute` remainder decomposition (months/years cannot be uniquely derived from milliseconds, so they are not provided). Field semantics (AUDIT-TIME-03):
  - `milliseconds` is the **exact signed** total duration
  - `seconds`/`minutes`/`hours`/`days`/`weeks` are `sign * floor(abs / unit)` (truncated on the absolute value, then signed)
  - `absolute` is a **non-negative remainder decomposition** of `abs` (e.g. -1500ms → `milliseconds: -1500, seconds: -1, absolute: {seconds: 1, milliseconds: 500}`)
  - A diff exceeding the safe integer range throws `time: diff duration out of range`
- **Default UTC**: when `timezone` is omitted, the result is independent of the runtime environment (`timezoneSource: "default-utc"`)

## npm 0.1.0-rc.7 Compatibility (Verified)

This plugin has been migrated to the npm 0.1.0-rc.7 dependency line and fully verified end-to-end in an isolated consumer of `@deepseek-ai/dsh@0.1.0-rc.7` (npm private package):

- **Types/runtime**: peers are `@deepseek-ai/cordis: ^4.0.1` + `@deepseek-ai/dsh-tools: >=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants: >=0.0.1-rc.1 <0.2.0`; no longer depends on the unscoped `cordis`
- **Standalone build**: `npm install` (devDependencies are self-contained: typescript/vitest/@types/node) → `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **Consumption verification**: tarball installed into a DSH 0.1.0-rc.7 (npm) consumer → `dsh --profile compat --dump-config` shows this plugin's row → tool registration and execution actually pass
- **Launch method**: `npx -p @deepseek-ai/dsh@0.1.0-rc.7 dsh web` (lib production mode; do not `install -g` globally)

## Version Adaptation

- **Adapted DSH**: DSH 0.1.0-rc.7 (npm) (profile/bundle plugin system)
- **bundle declaration**: `dsh.bundle` in `package.json` (patch points to `cordis.patch.yml`) + `exports` exports
- **patch format**: `cordis.patch.yml` uses a `- insert:` list (the patch is id-targeted; bare `- id:` entries report `entry not found`)
- **files**: the published tarball includes `lib/`, `src/`, `cordis.patch.yml`

## Installation

### Profile Bundle (Recommended)

Install this plugin into a profile as a standalone bundle (DSH 0.1.0-rc.7 (npm)). This repository lives under the [omdsh-dev](https://github.com/omdsh-dev) organization and is publicly accessible:

```sh
# Interactive (web) profile —— install from the GitHub repository
dsh plugin --profile web add github:omdsh-dev/dsh-tool-time
# One-off task (headless) profile —— dsh run uses headless by default
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-time
```

Or install from the tarball produced by `npm pack`:

```sh
npm pack     # produces dsh-tool-time-<version>.tgz
# Interactive (web) profile
dsh plugin --profile web add ./dsh-tool-time-<version>.tgz
# One-off task (headless) profile
dsh plugin --profile headless add ./dsh-tool-time-<version>.tgz
```

The bundled `dsh.bundle.patch` (pointing to `cordis.patch.yml`) automatically adds the plugin to the profile's layer stack after installation; the plugin's `cordis.patch.yml` inserts the `tool-time` entry via `- insert:`. The plugin's missing peer dependencies (`@deepseek-ai/cordis`, `@deepseek-ai/dsh-tools`) are provided by the profile's healed `profiles/node_modules` fallback installation.

> ⚠️ web and headless are **different profiles**: installing into web does not automatically cover headless; `dsh run` uses the headless profile by default. Use forward slashes for Windows paths (`C:/...`).

### Verify Installation

```sh
dsh --profile web --dump-config | grep tool-time
```

### Runtime Verification

```sh
dsh run "使用 time 工具获取当前 UTC 时间"
```

### Manual Installation and Legacy Compatibility (legacy monorepo scenario)

The monorepo way is only for legacy scenarios: old snapshots that do not support Profile Bundle, or plugin development/debugging environments:

1. Place into the monorepo: `cp -r time ~/.dsh/source/master/packages/tools/time` (development debugging)
2. Add `"@deepseek-ai/dsh-tool-time": "workspace:^"` to `apps/cli/package.json`; add `{ "path": "./packages/tools/time" }` to the `tsconfig.host.json` references
3. `pnpm install && pnpm run build`
4. Insert the plugin in the profile's user-layer patch (`~/.dsh/profiles/<name>/cordis.patch.yml`):

```yaml
- insert:
    - id: tool-time
      name: '@deepseek-ai/dsh-tool-time'
```

5. Verify: `dsh --profile <name> --dump-config | grep tool-time`

> Note: the patch is id-targeted (DSH 0.1.0-rc.7 (npm)) — a bare `- id:` entry reports `entry "xxx" not found`; you must wrap it in a `- insert:` list.

## Known Limitations

1. Distribution chain: peer dependencies (e.g. `@deepseek-ai/dsh-tools`) are npm private packages; standalone installation does not depend on the monorepo workspace (monorepo is legacy only)
2. `add` is UTC calendar arithmetic, not local wall-clock semantics (local wall-clock requires v2)
3. Natural-language dates ("next week") and calendar month/year diffs are not supported (v2)
4. Timezone data comes from Node's built-in ICU: "cross-platform consistency" means "consistency under the same Node/ICU data"
5. **Input year range is 1000–9999** (`0000`–`0999` rejected: JavaScript `Date.UTC` has a historical 1900+ mapping behavior for those years)
6. **Precision contract**: `iso`/`unix` preserve milliseconds; `local`/`formatted` are second-precision display fields
7. **Offset precision down to minutes**: v1 only supports modern timezones; second-level offsets of historical timezones (<1900) are truncated

## Tests

```bash
pnpm test
```

63 cases covering functionality/errors/attack payloads (fake clock, known timezone vectors, end-of-month clamping, strict ISO boundaries, year ranges, offsets crossing year boundaries, extreme amounts, prototype-chain timezone names, etc.). See the locally maintained design doc for the full list.

## License

MIT
