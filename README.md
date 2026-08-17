# 🧰 dsh-toolkit

[English](README.en.md)

DSH 零依赖工具包 collection —— time / encoding / json / calculator / csv / regex / markdown / diff / stat / schema 十个确定性工具，**统一入口一键安装**。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 为什么

DSH 生态仓库持续增长，单插件在 hub 中容易被淹没；collection 分类是辨识度最高的形态。本仓库把 10 个工具插件 **vendored 冻结**为 pack artifact 快照（各子仓库独立演进，当前源位于 [omdsh-dev](https://github.com/omdsh-dev) 组织下），统一工程、统一测试、统一维护。

**定位（官方 Profile Bundle 生态方向）**：本仓库是 **collection 与安装辅助仓库**——每个子包都是可独立安装/启用/禁用/卸载的 bundle（`dsh plugin --profile <p> add <子包>`）；collection 提供目录、清单与批量安装脚本。meta 包 `@deepseek-ai/dsh-toolkit` 保留为**可选**的原子挂载模型（见下文两种运行模型）。

**分发边界**：根 meta 包保持 `private: true`，用于 Git/collection 分发，不代表会发布到 npm registry。根目录已提交由当前 `src` 构建出的 `lib/index.js` 与 `lib/types/index.d.ts`，因此从 Git 安装时不依赖消费端 lifecycle；`prepack` 仍会在生成 pack artifact 前执行完整构建。

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
| `diff` | 文本/JSON/CSV/Markdown 结构化比较与 unified diff（只读） | 124 |
| `stat` | 描述统计 / 百分位数 / 频数分布 / 相关性（零依赖确定性） | 82 |
| `schema` | JSON Schema 验证 / 路径 / 解释 / 安全 default（零网络零动态） | 125 |
| **合计** | | **723** |

## 架构

```
dsh-toolkit/
├── src/index.ts          # meta 包：相对路径动态导入 10 个子包 apply()，聚合注册
├── packages/dsh-tool-*   # vendored 子包（pack artifact 快照，name 保持 @deepseek-ai/dsh-tool-*）
├── scripts/
│   ├── link-deps.sh      # 构建期 junction（cordis → vendor/cordis，dsh-tools → packages/core/tools）
│   ├── build-all.sh      # 一键构建 10 子包 + meta 包（tsc）
│   ├── test-all.sh       # 一键跑 10 子包 vitest（合计用例数）
│   ├── install.sh        # meta / 逐包两种挂载模式（含 dry-run）
│   ├── install-web.sh    # 独立 bundle 批量安装 → web profile
│   ├── install-headless.sh # 独立 bundle 批量安装 → headless profile
│   └── install-all.sh    # web + headless 都装
├── catalog.json          # collection 清单（hub collection 分类识别依据）
└── tsconfig.base.json    # 共享编译配置（固化踩坑经验）
```

> 与实施文档方案 A 的工程化适配：子包为私有 Git/collection 包，peer 名解析在 profile 内不可行，
> 故 meta 包采用**相对路径动态导入**（零解析魔法、打包自足）；子包 runtime 依赖
> （`@deepseek-ai/dsh-tools`）在 npm 独立模式（默认）下不依赖 DSH monorepo，monorepo 模式经子包构建期 junction 解析。

## 安装

仓库位于 [omdsh-dev/dsh-toolkit](https://github.com/omdsh-dev/dsh-toolkit)（public）。

### 独立 bundle 模型（推荐）

每个子包独立安装、启用、禁用、卸载：

```sh
# 安装单个工具到 web profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-csv
# 一次性任务（headless）profile
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-diff
```

批量安装（collection 辅助脚本，幂等——重复执行不会重复添加）：

```sh
./scripts/install-web.sh       # 全部 10 工具 → web profile
./scripts/install-headless.sh  # 全部 10 工具 → headless profile（dsh run 使用面）
./scripts/install-all.sh       # 两个 profile 都装
```

验证与运行：

```sh
dsh --profile web --dump-config | grep tool-csv     # 行存在即安装成功
dsh run "使用 csv 工具解析 'a,b\n1,2'"               # headless 端到端
```

> ⚠️ web 与 headless 是**不同 profile**：web 安装不会自动覆盖 headless；`dsh run` 默认使用 headless。
> Windows 路径使用正斜杠（`C:/...`）。

### npm pack tarball 安装

本地构建后用 tarball 路径安装（不依赖 GitHub）：

```sh
# tarball 方式（web 为例；headless 同）
npm pack
dsh plugin --profile web add <npm pack 产物 tarball 路径>
```

### meta bundle 模型（可选）

需要一次原子挂载全部工具时，挂载根 meta 包：

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-toolkit
dsh --profile web --dump-config | grep tool-kit
```

> ⚠️ 若 profile 已单独挂载过同名插件（tool-time/.../tool-diff/tool-stat/tool-schema），挂 meta 包会注册重名报错——
> 此时先移除旧插件，或用独立 bundle 模型。meta apply 具备原子性（任一子插件失败时
> 逆序回滚已注册工具，不残留部分状态）。

### 手动安装与旧版本兼容

旧场景（monorepo 集成、不支持 Profile Bundle 的旧快照或插件开发调试环境——本地 junction/symlink、手动编辑 profile 层）。

## 构建与测试

**npm 独立模式（默认，推荐）**：无需 DSH monorepo；`npm install`（devDependencies 自包含）后即可：

```bash
npm run build:all           # 10 子包 + meta 包 tsc + 产物完整性验证（无 .ts 残留导入、10+1 个 lib/index.js）
bash scripts/test-all.sh    # 10 子包 vitest 全量（723 用例）；任一失败整体非零退出
npm pack                    # prepack 自包含（build:all），tarball 含 lib + 10 个子包
```

**monorepo 模式（可选：源码贡献/旧 snapshot）**：显式提供 DSH monorepo 根：

```bash
export DSH_MONOREPO=<DSH 0.1.0-rc.6（npm）安装路径>   # 或作为第一个参数
bash scripts/build-all.sh   # link-deps + 10 子包 + meta 包 tsc + 产物完整性验证
bash scripts/test-all.sh
```

> `prepack` 已指向 `build:all`（完整构建 10 子包 + meta），保证 pack artifact 含全部运行入口；根 Git 入口由当前 `src` 预构建并提交。
> 本仓库只在本地验证构建、测试与 pack artifact；不要将这些结果解读为 npm registry 发布或未实际执行的 consumer/profile 验证。


## 同步 vendored（子仓库有更新时）

把 `packages/<name>` 与源仓库重新同步（src/tests/package.json/tsconfig/cordis.patch.yml/LICENSE/README.md），并在 README 标注子包版本。

## 新增工具

见 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)：复制模板子包 → 实现 → 测试 → build-all 验证 → 更新 catalog.json。

## 许可

MIT
