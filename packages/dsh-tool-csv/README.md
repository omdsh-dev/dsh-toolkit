# dsh-tool-csv

DSH CSV 数据工具插件 —— 解析、查询、过滤、统计和转换 CSV 文本。零依赖、纯函数、RFC 4180 状态机解析器。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 动机

Agent 会话里表格形态的数据（导出文件、API 响应、报告片段）出现频率很高。现有路径是起 `bash` 进程让模型现写解析脚本：

1. **每次调用都起进程**——Windows 上尤其昂贵
2. **模型手写 CSV 解析器错误率高**——引号内逗号、`""` 转义、BOM、跨行字段、CRLF 这些边界手写代码极易踩坑，且结果不可验证

本插件提供确定性、零依赖、纯函数的 CSV 处理：一次函数调用，毫秒级返回结构化 JSON。

与 `dsh-tool-json` 形成"结构化数据处理"对：JSON 管对象，CSV 管表格。

## 安全模型

- **零依赖**：不引入 csv 解析库，手写状态机（单遍扫描，O(n)）
- **纯函数**：不读文件、不写文件、不联网、不 eval
- **无注入面**：查询过滤只做字面精确匹配（`===`），不支持表达式求值
- **预算**：输入上限 256,000 字节（超限直接报错，不截断）；`timeoutMs: 2000`；`limit` 默认 100 行防输出膨胀
- 工具参数会记入会话日志，不要传入敏感数据

## 工具声明

注册 `csv` 工具（`@deepseek-ai/dsh-tool-csv`，row id `tool-csv`），统一输出 JSON 文本字符串。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | ✅ | `parse` / `query` / `stats` / `to_json` |
| `csv` | string | ✅ | CSV 文本（RFC 4180；引号字段可含逗号/换行；`""` 转义；忽略 BOM） |
| `column` | string | | 查询列：列名（有表头时）或 1-based 索引如 `"2"` |
| `value` | string | | 查询精确匹配值（严格相等，非子串） |
| `delimiter` | string | | 分隔符，默认 `","`；单字符或 `"tab"` |
| `header` | boolean | | 首行是否为表头，默认 `true`；`false` 时行解析为数组 |
| `limit` | integer | | 返回行数上限（query/parse），默认 100 |

## Actions

| action | 功能 | 输出示例 |
|---|---|---|
| `parse` | 解析为 JSON 数组（有表头时每行一个对象） | `[{"name":"Alice","city":"NYC"}]` |
| `query` | 按列名/索引精确过滤行（结果含表头，可回读） | `[["name","city"],["Alice","NYC"]]` |
| `stats` | 行数 / 列数 / 列名 / 空行数 / 警告（含重复列名、字段数不一致） | `{"rows":2,"columns":2,...}` |
| `to_json` | `parse` 的别名（模型友好） | 同 `parse` |

## 示例

```
csv { action: "parse", csv: "name,city\nalice,nyc\nbob,la" }
  → [{"name":"alice","city":"nyc"},{"name":"bob","city":"la"}]

csv { action: "query", csv: "name,city\nalice,nyc\nbob,la", column: "city", value: "la" }
  → [["name","city"],["bob","la"]]

csv { action: "stats", csv: "name,city\nalice,nyc" }
  → {"rows":1,"columns":2,"columnNames":["name","city"],"emptyRows":0,"warnings":[]}
```

## 边界行为

| 情况 | 处理 |
|---|---|
| 引号内逗号/换行/CRLF | 视为字段内容（跨行字段） |
| `""` 转义 | 解码为单个 `"` |
| **未闭合引号** | **报错**：`csv: unterminated quoted field`（严格模式，不静默容错） |
| **闭合引号后非法字符** | **报错**：`csv: invalid character "x" after closing quote`（RFC 4180：闭合后只允许分隔符/换行/EOF） |
| 首行 BOM | 剥离后再解析 |
| 空行 | 跳过（stats 报告空行数） |
| 字段数不一致 | 不报错：缺失补 `null`、多余并入最后一个字段（stats 记录警告） |
| 重复列名 | 后出现的列覆盖先出现的（stats 记录警告） |
| **`__proto__`/`constructor`/`prototype` 表头** | null-prototype 对象写入，**无损序列化**（`{"__proto__":"value"}`） |
| delimiter | 仅单 UTF-16 code unit 或 `"tab"`；拒绝 surrogate pair（如 `😀`）与控制字符（除 `\t`） |
| 无表头 | `header: false`，行解析为数组，`column` 用 1-based 索引 |
| 超 256KB 输入 | 直接报错（不截断） |
| 十万行级输入 | 单遍聚合计算列宽（无 spread），不触发 RangeError |

## 安装

### Profile Bundle（推荐）

将本插件作为独立 bundle 安装到 profile（0806+）：

```sh
# 交互式（web）profile
dsh plugin --profile web add "C:/path/to/dsh-tool-csv"
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add "C:/path/to/dsh-tool-csv"
```

包内 `dsh.bundle.patch` 会在安装后自动把插件加入 profile 的 layer stack（row id：`tool-csv`）。插件缺失的 peer 依赖（`cordis`、`@deepseek-ai/dsh-tools`）由 profile 的 healed `profiles/node_modules` 回退安装提供。

> ⚠️ web 与 headless 是**不同 profile**：web 安装不会自动覆盖 headless；`dsh run` 默认使用 headless profile。Windows 路径使用正斜杠（`C:/...`）。

### 验证安装

```sh
dsh --profile web --dump-config | grep tool-csv
```

### 运行验证

```sh
dsh run "使用 csv 工具解析 'a,b
1,2'"
```

### 手动安装与旧版本兼容

仅适用于不支持 Profile Bundle 的旧快照或插件开发调试环境（本地 junction/symlink、手动编辑 profile 层）。
## 测试

```bash
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

- `parse.spec.ts`：RFC 4180 边界（引号/转义/BOM/CRLF/空行/tab/大小上限/严格引号错误/delimiter 校验）
- `query.spec.ts`：列名/索引过滤、精确匹配、limit、错误路径、stats 警告、JSON 映射、危险表头、12.5 万行压力
- `register.spec.ts`：注册契约（AUDIT-CROSS-02 风格）

## 许可

MIT
