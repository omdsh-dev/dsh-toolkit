# dsh-tool-markdown

[English](README.en.md)

DSH Markdown 工具插件 —— HTML↔Markdown 转换、GFM 表格规范化、目录生成。零依赖、纯函数、手写轻量解析器。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 动机

模型最常见的文档场景：用户贴一段 HTML（网页源码、邮件、导出文件）、贴表格要求整理、或要求"转成 markdown"。没有工具时模型只能硬编码处理——HTML 实体会错、表格会乱、网页噪音（导航/脚本/广告）会混入。本插件提供确定性转换，与 `dsh-tool-csv` 互补：**csv 管结构化表格，markdown 管文档/网页**。

## 安全模型

- **零依赖**：手写递归下降 HTML 解析器（不引入 cheerio/jsdom——净增数十 MB 且是攻击面）
- **零执行面**：不 eval、不 new Function、不加载远程资源、不解析 CSS 布局
- **内容剥离**：script/style/iframe/object/noscript 内容整体剥离（安全 + 噪音）
- **md2html 白名单**：只输出 `p h1-h6 ul ol li blockquote pre code a img strong em br hr table thead tbody tr th td`；文本一律 HTML 转义——markdown 内嵌 `<script>` 只会显示为文本
- **链接 scheme 白名单**：`http/https/mailto`；`javascript:`/`data:` 链接降级为纯文本
- **资源上限**：嵌套深度 64 层报错（防栈溢出）；输入 `maxBytes` 默认 256KB、硬顶 1MB（超限报错不截断）
- 工具参数会记入会话日志，**不要传入含密钥/会话数据的 HTML**

## 工具声明

注册 `markdown` 工具（`@deepseek-ai/dsh-tool-markdown`，row id `tool-markdown`），统一输出文本。

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `action` | string | ✅ | `html2md` / `md2html` / `table` / `toc` |
| `html` | string | | html2md 输入（片段或完整文档） |
| `markdown` | string | | md2html/toc 输入 |
| `text` | string | | table 输入（HTML `<table>` 或管道分隔文本） |
| `baseUrl` | string | | 相对 href/src 解析基准（naive join） |
| `maxBytes` | integer | | 输入上限，默认 256000，硬顶 1000000 |

## Actions

| action | 功能 |
|---|---|
| `html2md` | HTML → GFM Markdown：块级/行内全映射、表格转 GFM（colspan 占位补齐）、实体解码、script/style 剥离、链接 scheme 过滤（**不做 readability 正文选择**，nav/header/footer 默认透传） |
| `md2html` | Markdown → 白名单安全 HTML：全文本转义，无标签可逃逸 |
| `table` | HTML `<table>` 或**含未转义 `\|`** 的管道分隔文本 → GFM 表格（列补齐、`\|` 转义、分隔行识别；无管道输入报错） |
| `toc` | Markdown 标题 → 嵌套目录列表（简化 GitHub 风格锚点：重复标题自动 -1/-2 后缀、跳过代码围栏内伪标题） |

## 示例

```
markdown { action: "html2md", html: "<h1>标题</h1><p>你好 <b>世界</b></p>" }
  → # 标题\n\n你好 **世界**

markdown { action: "md2html", markdown: "[x](javascript:alert(1))" }
  → <p>x</p>          ← javascript: 链接降级为纯文本

markdown { action: "table", text: "a|b\n1|2" }
  → | a | b |\n| --- | --- |\n| 1 | 2 |

markdown { action: "toc", markdown: "# 标题一\n## 小节" }
  → - [标题一](#标题一)\n  - [小节](#小节)
```

## 边界行为

| 情况 | 处理 |
|---|---|
| 未闭合标签 | EOF 自动闭合（与浏览器方向一致）；`<p>` 中遇块级自动关闭 |
| 大小写 | 标签/属性名归一为小写 |
| 注释/DOCTYPE/CDATA | 剥离 |
| 实体 | 命名 + 数字实体解码；未知实体按字面保留（`&amp;lt;` → `&lt;`，不二次解码） |
| 嵌套列表 | `li` 只被新 `li` 关闭——嵌套 `ul/ol` 合法（2 空格/层缩进） |
| 空白 | 行内折叠为单空格；`pre/code` 原样保留 |
| 表格 | 首行（thead `th` 或首行 `td`）为表头；`colspan=N` 补 N-1 个占位单元格 |
| 深度 > 64 层 | `markdown: HTML nesting exceeds 64 levels` |
| 输入超限 | `markdown: <label> exceeds N bytes`（不截断） |
| md2html 内嵌 HTML | 原样转义为文本，绝无白名单外标签输出 |

## npm 0.1.0-rc.8 兼容（已验证）

本插件已迁移到 npm 0.1.0-rc.8 依赖线，并在 `@deepseek-ai/dsh@0.1.0-rc.8` 的隔离 consumer 中完成全链路验证：

- **类型/运行时**：`@deepseek-ai/cordis@^4.0.1` + `@deepseek-ai/dsh-tools@>=0.0.1-rc.1 <0.2.0` + `@deepseek-ai/dsh-invariants@>=0.0.1-rc.1 <0.2.0`（peer）；不再依赖 unscoped `cordis`
- **独立构建**：`npm install`（devDependencies 自包含 typescript/vitest/@types/node）→ `npm run typecheck` → `npm test` → `npm run build` → `npm pack`
- **消费验证**：tarball 装入 0.1.0-rc.8 consumer → `dsh --profile compat --dump-config` 出现本插件 row → 工具真实注册与执行通过
- **启动方式**：`npx -p @deepseek-ai/dsh@0.1.0-rc.8 dsh web`（lib 生产模式；勿 `install -g` 全局安装）


## 安装

插件源码仓库：`https://github.com/omdsh-dev/dsh-tool-markdown`（public）。

### Profile Bundle（推荐）

将本插件作为独立 bundle 安装到 profile（DSH 0.1.0-rc.8，npm）：

```sh
# 交互式（web）profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-markdown
# 一次性任务（headless）profile —— dsh run 默认使用 headless
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-markdown
```

包内 `dsh.bundle.patch` 会在安装后自动把插件加入 profile 的 layer stack（row id：`tool-markdown`）。

> ⚠️ web 与 headless 是**不同 profile**：web 安装不会自动覆盖 headless；`dsh run` 默认使用 headless profile。

### npm pack tarball 安装

```sh
npm pack    # 生成 dsh-tool-markdown-*.tgz
dsh plugin --profile web add ./dsh-tool-markdown-*.tgz
dsh plugin --profile headless add ./dsh-tool-markdown-*.tgz
```

### 验证安装

```sh
dsh --profile web --dump-config | grep tool-markdown
```

### 运行验证

```sh
dsh run "使用 markdown 工具把 <h1>标题</h1> 转成 Markdown"
```

### 手动安装与旧版本兼容

仅适用于不支持 Profile Bundle 的旧快照或插件开发调试环境（本地 junction/symlink、手动编辑 profile 层）。
## 测试

```bash
node <monorepo>/node_modules/vitest/vitest.mjs run tests
```

- `html.spec.ts`：解析器边界（嵌套/未闭合/大小写/自闭合/注释/script 剥离/实体/畸形属性/深度守卫）
- `html2md.spec.ts`：块级与行内映射全表、表格（colspan/表头/转义）、scheme 过滤、baseUrl
- `md2html.spec.ts`：白名单结构 + 安全（内嵌 script 转义、javascript: 降级、引号转义）
- `table.spec.ts`：HTML/管道输入、列补齐、`\|` 转义；`toc.spec` 目录与 slugify
- `register.spec.ts`：注册契约（AUDIT-CROSS-02 风格）

## 许可

MIT
