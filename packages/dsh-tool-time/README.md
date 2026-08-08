# dsh-tool-time

DSH 时间工具插件 —— 严格 ISO 解析、IANA 时区转换、UTC 日历运算、固定时长差。零依赖、零进程、纯函数。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 动机

Agent 处理时间信息是最高频需求之一——"现在几点"、"3 天后是几号"、"把 UTC 转成北京时间"。当前做法 `bash date` 的问题：每次起进程、跨平台语法不一致（macOS 与 GNU `date -d` 完全不同）、时区转换靠 `TZ=...` 手动拼。模型心算时区偏移和闰年/DST 边界是错误高发区。

## 安全模型

无 `eval`、无 `new Function`。输入只经过严格校验：

- **严格 ISO 8601 子集**：仅接受 `YYYY-MM-DD`（UTC 零点）、`YYYY-MM-DDTHH:mm:ssZ`、`YYYY-MM-DDTHH:mm:ss±HH:MM`（±14:00 内，可选 `.SSS` 毫秒）；不带时区的日期时间、RFC 2822、自然语言日期一律拒绝；`2026-02-30` 等日历溢出由查表校验拒绝（不依赖 Date 的静默归一化）
- **时区名**：IANA 名交给 `Intl.DateTimeFormat` 校验，非法即抛 `time: unknown timezone`
- **数值**：`amount` 必须是安全整数；`unit` 枚举白名单；所有字符串 ≤200 字符
- **Intl 环境固定**：`'en-CA'` + `hourCycle: 'h23'`（避免午夜 `24:00` 与本地化数字）

## 架构

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

## 工具声明

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

## 支持的操作

| action | 参数 | 返回 |
|--------|------|------|
| `now` | `timezone?`（默认 UTC） | 当前时间结构化表示 |
| `convert` | `value` + `timezone`（必填） | 转换后的结构化时间 |
| `add` | `value` + `amount` + `unit`（`timezone?` 仅展示） | 加减后的结构化时间 |
| `diff` | `from` + `to` | 固定时长差（无月份/年份） |

返回结构（canonical value）：

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

语义契约：

- **`add` 始终基于 UTC 运算**（日历日语义，跨 DST 保持"日历日"直觉）；`timezone` 仅决定 `local`/`formatted` 展示
- **月份/年份钳制**：`2026-01-31 + 1 month = 2026-02-28`；`2028-02-29 + 1 year = 2029-02-28`（先置 1 日 → 定位目标年月 → 按目标月最大天数钳制）
- **`diff` 仅固定时长**：`sign` + 带符号总量 + `absolute` 余数分解（月/年无法从毫秒唯一推导，不提供）。字段语义（AUDIT-TIME-03）：
  - `milliseconds` 是**精确带符号**总时长
  - `seconds`/`minutes`/`hours`/`days`/`weeks` 是 `sign * floor(abs / unit)`（对绝对值截断后带符号）
  - `absolute` 是 `abs` 的**非负余数分解**（如 -1500ms → `milliseconds: -1500, seconds: -1, absolute: {seconds: 1, milliseconds: 500}`）
  - 差值超过安全整数范围抛 `time: diff duration out of range`
- **默认 UTC**：省略 `timezone` 时结果与运行环境无关（`timezoneSource: "default-utc"`）

## 版本适配

- **适配 DSH snapshot**: `20260806T160212Z-279244acb0`（0806 迁移：profile/bundle 插件系统）
- **bundle 声明**: `package.json` 的 `dsh.bundle`（patch 指向 `cordis.patch.yml`）+ `exports` 导出
- **patch 格式**: `cordis.patch.yml` 使用 `- insert:` 列表（0806 的 patch 是 id-targeted 语义，裸 `- id:` 条目会报 `entry not found`）
- **files**: 发布 tarball 含 `lib/`、`src/`、`cordis.patch.yml`

## 接入方式

### 方式 A：DSH profile 插件安装（0806+，推荐）

等 `@deepseek-ai/dsh-tools` 发布到 npm 后，本插件可作为独立 bundle 一键安装到任意 profile：

```bash
dsh plugin --profile headless add @dsh-external/dsh-tool-time
dsh plugin --profile web add @dsh-external/dsh-tool-time
```

包内 `dsh.bundle` 声明（patch 指向 `cordis.patch.yml`）会在安装后自动把插件加入 profile 的 layer stack；插件的 `cordis.patch.yml` 以 `- insert:` 插入 `tool-time` 条目。插件缺失的 peer 依赖（`cordis`、`@deepseek-ai/dsh-tools`）由 profile 的 healed `profiles/node_modules` 回退安装提供。

### 方式 B：monorepo 集成 + profile patch（当前可用）

在 `@deepseek-ai/dsh-tools` 发布前，走 DSH monorepo：

1. 放入 monorepo：`cp -r time ~/.dsh/source/master/packages/tools/time`
2. `apps/cli/package.json` 加 `"@deepseek-ai/time": "workspace:^"`；`tsconfig.host.json` references 加 `{ "path": "./packages/tools/time" }`
3. `pnpm install && pnpm run build`（monorepo 根构建，产出 `lib/`）
4. 在 profile 用户层 patch 插入插件（`~/.dsh/profiles/<name>/cordis.patch.yml`）：

```yaml
- insert:
    - id: tool-time
      name: '@deepseek-ai/time'
```

5. 验证：`dsh --profile <name> --dump-config | grep tool-time`

> 0806 注意：patch 是 id-targeted 语义——裸 `- id:` 条目会报 `entry "xxx" not found`，必须用 `- insert:` 列表包裹。
## 已知限制

1. 分发链路：`@deepseek-ai/dsh-tools` 私有，需 monorepo workspace
2. `add` 是 UTC 日历运算，非当地墙钟语义（当地墙钟需 v2）
3. 不支持自然语言日期（"next week"）与日历月/年差（v2）
4. 时区数据来自 Node 内置 ICU："跨平台一致" = "相同 Node/ICU 数据下一致"
5. **输入年份范围为 1000–9999**（`0000`–`0999` 拒绝：JavaScript `Date.UTC` 对这些年份有 1900+ 映射的历史行为）
6. **精度契约**：`iso`/`unix` 保留毫秒；`local`/`formatted` 为秒精度展示字段
7. **offset 精度到分钟**：v1 只支持现代时区；历史时区（<1900）的秒级 offset 会被截断

## 测试

```bash
pnpm test
```

功能/错误/攻击载荷共 63 个用例（fake clock、时区已知向量、月末钳制、严格 ISO 边界、年份范围、offset 跨年、极端 amount、原型链时区名等）。完整清单见本地维护的设计文档。

## 许可

MIT
