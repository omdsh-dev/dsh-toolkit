# dsh-tool-diff

[English](README.en.md)

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
| `ignoreWhitespace` | boolean | | 比较时忽略空白差异（text/csv/markdown）；**patch action 拒绝**（精确文本协议） |
| `ignoreCase` | boolean | | 比较时忽略大小写（text/json/csv/markdown）；**patch action 拒绝** |
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

- **行级 Myers**：O(ND) 迭代实现（非递归），trace 回溯；公共前后缀修剪后在小规模上运行，保证内存与时间有界；快速拒绝使用与 `lineEqual` 相同的归一化键（ignore 选项下不漏判公共行）
- **CSV 双模式**：提供 `key` 且表头存在 → keyed（行顺序无关）；否则 positional（按数据行号）。**before/after 两侧**重复 key 都进 `duplicateKeys` 且 `equal=false`，重复 key 的行不参与匹配（结果确定）；空字符串 key 与缺失 key（`<missing-key>`）不混淆
- **Markdown 块对齐**：按块类型 token 做 Myers，同型块内容变化 → `replace`，结构增删 → `add/remove`；标题按父路径+级别匹配，同路径同级别文本变化 → `rename`；代码块语言/行数/内容任一变化都进 `codeBlockChanges`（内容变化带 `changed:true`）
- **JSON 深度防线**：`JSON.parse` 之前先做 O(n) 非递归括号扫描（跳过字符串字面量），超 64 层直接报错；**重复键**由状态机扫描并随输出报告（`duplicateKeys.before/after`），不静默丢信息
- **patch 语义**：`equal` = 两侧在精确行 + 末尾换行语义下相等（与 `valid` 无关）；`valid` 只表示"生成的 patch 可从 before 应用到 after"；hunk 坐标（old/new、顺序、重叠、间隙）严格校验；patch 被截断时 `valid:false` + `patchComplete:false`
- **Unicode**：孤立 surrogate 在入口被拒绝（`invalid Unicode`）
- **可复现输出**：unified diff 无时间戳；`sortKeys` 默认 true 使变更列表稳定；所有 action 最终 JSON 信封 ≤ 64KiB（契约断言）

## 构建与测试

```bash
# 构建（零依赖，仅需 monorepo 的 tsc）
node <monorepo>/node_modules/typescript/bin/tsc -p tsconfig.json

# 测试（vitest，124 个用例）
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

## npm 0.1.0-rc.6 兼容（已验证）

本插件已迁移到 npm 0.1.0-rc.6 依赖线，并在 `@deepseek-ai/dsh@0.1.0-rc.6` 的隔离 consumer 中完成全链路验证：

- **类型/运行时**：`@deepseek-ai/cordis: ^4.0.1` + `@deepseek-ai/dsh-tools: >=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants: >=0.0.1-rc.1 <0.2.0`（peer）；不再依赖 unscoped `cordis`
- **独立构建**：`npm install`（devDependencies 自包含 typescript/vitest/@types/node）→ `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **消费验证**：tarball 装入 0.1.0-rc.6 consumer → `dsh --profile compat --dump-config` 出现本插件 row → 工具真实注册与执行通过
- **启动方式**：`npx -p @deepseek-ai/dsh@0.1.0-rc.6 dsh web`（lib 生产模式；勿 `install -g` 全局安装）


## 安装

### Profile Bundle（推荐）

DSH 0.1.0-rc.6（npm）起，本插件可作为独立 bundle 一键安装到任意 profile（仓库位于 https://github.com/omdsh-dev，public）：

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-diff
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-diff
```

也可以先用 `npm pack` 打出 tarball 再安装：

```sh
git clone https://github.com/omdsh-dev/dsh-tool-diff
cd dsh-tool-diff
npm install && npm pack
dsh plugin --profile web add ./deepseek-ai-dsh-tool-diff-*.tgz
dsh plugin --profile headless add ./deepseek-ai-dsh-tool-diff-*.tgz
```

包内 `dsh.bundle.patch` 会在安装后自动把插件加入 profile 的 layer stack（row id：`tool-diff`）。插件缺失的 peer 依赖（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-invariants`）由 profile 的 healed `profiles/node_modules` 回退安装提供。

> ⚠️ web 与 headless 是**不同 profile**：web 安装不会自动覆盖 headless；`dsh run` 默认使用 headless profile。Windows 路径使用正斜杠（`C:/...`）。

### 验证安装

```sh
dsh --profile web --dump-config | grep tool-diff
```

### 运行验证

```sh
dsh run "使用 diff 工具对比两段文本"
```

### 手动安装（源码贡献 / 旧 snapshot 场景）

仅适用于源码贡献（在 monorepo 中开发调试本插件）或仍在使用旧 snapshot 的场景（本地 junction/symlink、手动编辑 profile 层）。

## 许可

MIT
