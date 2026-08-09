# 🧰 dsh-toolkit

DSH 零依赖工具包 collection —— time / encoding / json / calculator / csv / regex / markdown / diff 八个确定性工具，**统一入口一键安装**。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 为什么

dsh-external 组织仓库持续增长，单插件在 hub 中容易被淹没；collection 分类是辨识度最高的形态。本仓库把 8 个工具插件 **vendored 冻结**为发布态快照（各子仓库仍独立演进），meta 包 `@deepseek-ai/dsh-toolkit` 一次挂载、一行 patch，统一工程、统一测试、统一维护。

## 工具一览

| 工具 | 能力 | 用例数 |
|---|---|---|
| `time` | ISO 8601 / 时区 / 日历运算 / 时长差 | 65 |
| `encoding` | base64 / url / hex / hash / UUID | 46 |
| `json` | JMESPath 子集查询 | 66 |
| `calculator` | 安全数学表达式求值（无 eval） | 31 |
| `csv` | RFC 4180 解析 / 查询 / 统计（严格引号） | 50 |
| `regex` | 测试 / 提取 / 替换 / 静态解释（worker 硬超时） | 63 |
| `markdown` | HTML↔Markdown / GFM 表格 / 目录生成（白名单安全） | 71 |
| `diff` | 文本/JSON/CSV/Markdown 结构化比较与 unified diff（只读） | 94 |
| **合计** | | **486** |

## 架构

```
dsh-toolkit/
├── src/index.ts          # meta 包：相对路径动态导入 8 个子包 apply()，聚合注册
├── packages/dsh-tool-*   # vendored 子包（发布态快照，name 保持 @deepseek-ai/dsh-tool-*）
├── scripts/
│   ├── link-deps.sh      # 构建期 junction（cordis → vendor/cordis，dsh-tools → packages/core/tools）
│   ├── build-all.sh      # 一键构建 8 子包 + meta 包（tsc）
│   ├── test-all.sh       # 一键跑 8 子包 vitest（合计用例数）
│   └── install.sh        # 一键挂载到 profile
├── catalog.json          # collection 清单（hub collection 分类识别依据）
└── tsconfig.base.json    # 共享编译配置（固化踩坑经验）
```

> 与实施文档方案 A 的工程化适配：子包为私有未发布包，peer 名解析在 profile 内不可行，
> 故 meta 包采用**相对路径动态导入**（零解析魔法、打包自足）；子包 runtime 依赖
> （`@deepseek-ai/dsh-tools`）经子包自身构建期 junction 解析。

## 安装

```bash
# 方式 A：meta 包一行挂载（推荐）
dsh plugin --profile web add "C:/path/to/dsh-toolkit"
dsh plugin --profile headless add "C:/path/to/dsh-toolkit"

# 方式 B：脚本逐个挂载子包（与已有独立插件共存时用）
./scripts/install.sh web all
# 脚本也支持 meta 模式（默认）与 dry-run：DRY_RUN=1 ./scripts/install.sh web all
```

> ⚠️ 若 profile 已单独挂载过同名插件（tool-time/.../tool-markdown），挂 meta 包会注册重名报错——
> 此时用方式 B（逐包挂载）或先移除旧插件。meta apply 具备原子性（任一子插件失败时
> 逆序回滚已注册工具，不残留部分状态）。

## 验证

```bash
dsh --profile web --dump-config | grep tool-kit
# # == @deepseek-ai/dsh-toolkit
# - id: tool-kit
#   name: '@deepseek-ai/dsh-toolkit'
```

## 构建与测试

**前置条件**（审查 TK-02 修复）：脚本不再内置本机路径，必须显式提供 DSH monorepo 根：

```bash
export DSH_MONOREPO=/c/Users/admin/.dsh/source/staging-20260808T121140Z   # 或作为第一个参数
bash scripts/build-all.sh   # link-deps + 8 子包 + meta 包 tsc + 产物完整性验证（无 .ts 残留导入、8+1 个 lib/index.js）
bash scripts/test-all.sh    # 8 子包 vitest 全量（486 用例）；任一失败整体非零退出
```

> `prepack` 已指向 `build:all`（完整构建 7 子包 + meta），保证发布 tarball 含全部运行入口。


## 同步 vendored（子仓库有更新时）

把 `packages/<name>` 与源仓库重新同步（src/tests/package.json/tsconfig/cordis.patch.yml/LICENSE/README.md），并在 README 标注子包版本。

## 新增工具

见 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)：复制模板子包 → 实现 → 测试 → build-all 验证 → 更新 catalog.json。

## 许可

MIT
