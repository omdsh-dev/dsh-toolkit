# dsh-tool-diff

DSH Diff 文本差异工具插件 —— 文本 / JSON / CSV / Markdown 结构化比较与 unified diff 生成。零依赖、纯函数、只读。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 动机

Agent 需要对比两份内容（配置片段、API 响应、表格、文档修订）时，现有路径是起 `bash` 进程调用系统 diff 或手写比较逻辑：

1. **每次调用都起进程**——Windows 上尤其昂贵
2. **系统 diff 不懂结构**——JSON 只能给整段文本差异，看不出 `$.user.name` 这样的路径级变更
3. **手写比较代码不可验证**——边界（引号内逗号、嵌套数组、标题重命名）极易出错

本插件提供确定性、零依赖、纯函数的差异比较：一次函数调用，毫秒级返回结构化 JSON 报告或标准 unified diff。

## 安全模型

- **零依赖**：Myers 行级 diff、RFC 4180 解析器、JSON 递归比较全部手写
- **只读**：不读文件、不写文件、不联网、不调 git；`patch` action 只在内存中生成并校验补丁，绝不落盘
- **预算**：
  - 输入单侧 ≤ 256 KiB（超限直接报错）
  - 输出 ≤ 64 KiB（超限按 `maxChanges` 与字节预算截断并置 `truncated`）
  - Myers diagonal 预算 2000 + 蛇步总预算 2000 万 + 公共前后缀修剪 + hash 快速拒绝 + 规模上限 4000 行 → 恶意重复/全异文本有界完成
  - 行数 ≤ 50K、JSON 嵌套 ≤ 64 层、CSV ≤ 50K 行 / 512 列
  - `timeoutMs: 2000`
- 工具参数会记入会话日志，不要传入敏感数据

## 工具声明

注册 `diff` 工具（`@deepseek-ai/dsh-tool-diff`，row id `tool-diff`），统一输出 JSON 文本字符串信封：所有 action 都带通用摘要 `{ equal, truncated, beforeBytes, afterBytes, changes }`。

| action | 作用 | 输出 |
|---|---|---|
| `text` | 行级 Myers diff | unified diff（`--- before` / `+++ after` / `@@` hunks，无时间戳）+ 统计；`format=structured` 输出带行号的操作列表 |
| `json` | 递归比较两个 JSON 值 | `$` 路径化变更（`$.user.name`、`$.items[0]`、`$['a.b']`）+ add/remove/replace 汇总 |
| `csv` | RFC 4180 解析后按主键或位置比较 | `addedRows` / `removedRows` / `changedRows`（列级）/ `duplicateKeys` / 列集合变化 |
| `markdown` | 轻量块级 tokenizer（标题/代码块/列表/引用/表格） | `headingChanges`（rename 识别）/ `blockChanges`（`h2[1]/p[0]` 路径）/ `codeBlockChanges` + 全文 diff |
| `patch` | 生成 unified diff 并在内存中校验 | patch 文本 + `valid` / `hunks` / `targetMatchesAfter` / hunk 级错误 |

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | ✅ | `text` / `json` / `csv` / `markdown` / `patch` |
| `before` | string | ✅ | 原内容（任意 action 的输入侧） |
| `after` | string | ✅ | 新内容 |
| `format` | string | | `unified`（默认 text/patch）/ `structured`（默认 json/csv/markdown）/ `both` |
| `context` | integer | | unified 上下文行数，默认 3，范围 0..20 |
| `key` | string | | CSV 主键列名或 1-based 索引；缺省 → 位置比较 |
| `delimiter` | string | | CSV 分隔符，默认 `,`，单字符或 `tab` |
| `ignoreWhitespace` | boolean | | 比较时忽略空白差异（text/csv/markdown） |
| `ignoreCase` | boolean | | 比较时忽略大小写 |
| `sortKeys` | boolean | | JSON 键排序，默认 true |
| `maxChanges` | integer | | 最大报告变更数，默认 1000，硬顶 10000 |

## 输出示例

```json
{"kind":"json","equal":false,"beforeBytes":42,"afterBytes":58,"changes":[
  {"op":"replace","path":"$.tags[1]","before":"b","after":"c"},
  {"op":"add","path":"$.user.email","after":"b@x.com"},
  {"op":"replace","path":"$.user.name","before":"Alice","after":"Bob"}],
 "summary":{"added":1,"removed":0,"replaced":2,"moved":0}}
```

## 设计要点

- **行级 Myers**：O(ND) 迭代实现（非递归），trace 回溯；公共前后缀修剪后在小规模上运行，保证内存与时间有界
- **CSV 双模式**：提供 `key` 且表头存在 → keyed（行顺序无关）；否则 positional（按数据行号）。重复 key 不静默覆盖，进 `duplicateKeys` 且 `equal=false`
- **Markdown 块对齐**：按块类型 token 做 Myers，同型块内容变化 → `replace`，结构增删 → `add/remove`；标题按父路径+级别匹配，同路径同级别文本变化 → `rename`
- **JSON 深度防线**：`JSON.parse` 之前先做 O(n) 非递归括号扫描（跳过字符串字面量），超 64 层直接报错
- **可复现输出**：unified diff 无时间戳；`sortKeys` 默认 true 使变更列表稳定

## 构建与测试

```bash
# 构建（零依赖，仅需 monorepo 的 tsc）
node <monorepo>/node_modules/typescript/bin/tsc -p tsconfig.json

# 测试（vitest，94 个用例）
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

接入方式：在 cordis.yml 追加 `- id: tool-diff` / `name: '@deepseek-ai/dsh-tool-diff'`，或 `dsh plugin --profile <name> add <本仓库路径>`。

## 许可

MIT
