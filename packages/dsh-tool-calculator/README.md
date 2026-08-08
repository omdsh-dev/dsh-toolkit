# dsh-tool-calculator

DSH 计算器工具插件 —— 安全的数学表达式求值器。零依赖、零进程、纯函数。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 动机

Agent 做算术不稳定是 LLM 的通病。DSH 内置的 `bash` 工具可以调用 `echo $((15 + 27 * 3))` 完成计算，但有两个问题：

1. **每次算术都起一个 bash 进程**——Windows 上尤其昂贵（创建进程、加载 shell、执行、收集输出），高频调用时累积延迟显著
2. **bash 算术语法有限**——不支持 `sqrt`、`sin`、`cos`、`log`、`pow` 等数学函数，agent 在这些场景下只能猜答案或写脚本

本插件提供零依赖、零进程、纯函数的计算器——一次函数调用，毫秒级得出结果，覆盖常用初等数学函数。

## 安全模型

**无 `eval`、无 `new Function`。** 使用手写递归下降解析器（词法层 + 语法层），只求值白名单节点：

- 词法层只识别数字字面量、白名单标识符、运算符；引号、分号、反引号、`{}` `[]` 直接报错
- 标识符按名查白名单表（15 个函数 + 2 个常量），查不到即抛 `Unknown identifier`
- 求值结果必须是有限数字，`NaN`/`Infinity`（除零、负数开方等）统一拒绝

`new Function` + 正则白名单是**不安全的**——`constructor.constructor(...)` 可直达 `Function` 构造器执行任意代码，`process.exit(0)` 可直接杀死宿主进程（均已实测复现）。本实现不使用任何代码求值捷径。

## 架构

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

- `src/index.ts`：Cordis 插件入口（`name`/`inject`/`apply`），注册 `calculator` 工具
- `src/evaluate.ts`：`evaluate(expression: unknown): number`——入口独立校验类型（非字符串抛 `calculator: expression must be a string`），返回有限数字，非法输入全部抛错

## 工具声明

```ts
import type { Context } from 'cordis'
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

## 支持的操作

| 类别 | 项目 |
|------|------|
| 算术 | `+` `-` `*` `/` `%` `**`（幂，右结合：`2 ** 3 ** 2` = 512） |
| 函数（单参） | `abs` `ceil` `floor` `round` `sqrt` `log` `log2` `log10` `exp` `sin` `cos` `tan` |
| 函数（多参） | `pow(x, y)` `max(a, b, ...)` `min(a, b, ...)` |
| 常量 | `PI` `E` |
| 分组 | `(` `)`，一元正负 `+5` `-5` |

优先级：`**`（右结合）> 一元 `±` > `* / %` > `+ -`。

## 版本适配

- **适配 DSH snapshot**: `20260806T160212Z-279244acb0`（0806 迁移：profile/bundle 插件系统）
- **bundle 声明**: `package.json` 的 `dsh.bundle`（patch 指向 `cordis.patch.yml`）+ `exports` 导出
- **patch 格式**: `cordis.patch.yml` 使用 `- insert:` 列表（0806 的 patch 是 id-targeted 语义，裸 `- id:` 条目会报 `entry not found`）
- **files**: 发布 tarball 含 `lib/`、`src/`、`cordis.patch.yml`

## 接入方式

### 方式 A：DSH profile 插件安装（0806+，推荐）

等 `@deepseek-ai/dsh-tools` 发布到 npm 后，本插件可作为独立 bundle 一键安装到任意 profile：

```bash
dsh plugin --profile headless add @dsh-external/dsh-tool-calculator
dsh plugin --profile web add @dsh-external/dsh-tool-calculator
```

包内 `dsh.bundle` 声明（patch 指向 `cordis.patch.yml`）会在安装后自动把插件加入 profile 的 layer stack；插件的 `cordis.patch.yml` 以 `- insert:` 插入 `tool-calculator` 条目。插件缺失的 peer 依赖（`cordis`、`@deepseek-ai/dsh-tools`）由 profile 的 healed `profiles/node_modules` 回退安装提供。

### 方式 B：monorepo 集成 + profile patch（当前可用）

在 `@deepseek-ai/dsh-tools` 发布前，走 DSH monorepo：

1. 放入 monorepo：`cp -r calculator ~/.dsh/source/master/packages/tools/calculator`
2. `apps/cli/package.json` 加 `"@deepseek-ai/calculator": "workspace:^"`；`tsconfig.host.json` references 加 `{ "path": "./packages/tools/calculator" }`
3. `pnpm install && pnpm run build`（monorepo 根构建，产出 `lib/`）
4. 在 profile 用户层 patch 插入插件（`~/.dsh/profiles/<name>/cordis.patch.yml`）：

```yaml
- insert:
    - id: tool-calculator
      name: '@deepseek-ai/calculator'
```

5. 验证：`dsh --profile <name> --dump-config | grep tool-calculator`

> 0806 注意：patch 是 id-targeted 语义——裸 `- id:` 条目会报 `entry "xxx" not found`，必须用 `- insert:` 列表包裹。
## 用法

安装后，agent 自动获得 `calculator` 工具：

```
calculator { expression: "15 + 27 * sqrt(9)" }  →  96
```

工具名满足 DeepSeek 函数名约束（≤64 字符，`[A-Za-z0-9_-]`）。注册后自动进入 Code Mode SDK（`await tools.calculator(...)`），canonical 返回值为数字。

## 已知限制

1. **分发链路**：`@deepseek-ai/dsh-tools` 是 DSH monorepo 私有包（未发布 npm），本插件需放入 monorepo 走 workspace 解析
2. **三角函数使用弧度**：与 `Math.sin`/`Math.cos` 一致；需要角度时写 `sin(30 * PI / 180)`
3. **不支持大整数**：JS `number` 是 IEEE 754 double，安全整数范围 ±9e15，超出有精度损失
4. **不支持科学计数法**：`1e5` 会被词法层拒绝

## 测试

```bash
pnpm test
```

包含功能用例与攻击载荷用例（`constructor.constructor` 链、`process.exit(0)`、`globalThis`、引号注入、分号语句等）。完整用例清单见本地维护的设计文档。

## 许可

MIT
