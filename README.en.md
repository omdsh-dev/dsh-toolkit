# 🧰 dsh-toolkit

[中文](README.md)

DSH zero-dependency toolkit collection — ten deterministic tools: time / encoding / json / calculator / csv / regex / markdown / diff / stat / schema, **installed with one click through a unified entry**.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why

DSH ecosystem repositories keep growing, and a single plugin is easily drowned out in the hub; the collection category is the form with the highest recognizability. This repository **vendors and freezes** the 10 tool plugins as pack-artifact snapshots (each sub-repository evolves independently, with the current source under the [omdsh-dev](https://github.com/omdsh-dev) organization), with unified engineering, unified testing, and unified maintenance.

**Positioning (in line with the official Profile Bundle ecosystem direction)**: this repository is a **collection and installation-aid repository** — every sub-package is a bundle that can be independently installed/enabled/disabled/uninstalled (`dsh plugin --profile <p> add <sub-package>`); the collection provides the catalog, the manifest, and batch installation scripts. The meta package `@deepseek-ai/dsh-toolkit` is retained as an **optional** atomic-mount model (see the two runtime models below).

**Distribution boundary**: the root meta package remains `private: true` for Git/collection distribution; this does not mean it is published to the npm registry. The root `lib/index.js` and `lib/types/index.d.ts` are committed build outputs from the current `src`, so Git installation does not depend on a consumer-side lifecycle; `prepack` remains enabled for creating a pack artifact.

## Tools at a Glance

| Tool | Capability | Test cases |
|---|---|---|
| `time` | ISO 8601 / timezone / calendar arithmetic / duration difference | 65 |
| `encoding` | base64 / url / hex / hash / UUID | 46 |
| `json` | JMESPath subset queries | 66 |
| `calculator` | Safe math expression evaluation (no eval) | 31 |
| `csv` | RFC 4180 parsing / querying / statistics (strict quoting) | 50 |
| `regex` | Test / extract / replace / static explanation (worker hard timeout) | 63 |
| `markdown` | HTML↔Markdown / GFM tables / TOC generation (allowlist-safe) | 71 |
| `diff` | Structured comparison and unified diff for text/JSON/CSV/Markdown (read-only) | 124 |
| `stat` | Descriptive statistics / percentiles / frequency distribution / correlation (zero-dependency deterministic) | 82 |
| `schema` | JSON Schema validation / paths / explanation / safe defaults (zero network, zero dynamic) | 125 |
| **Total** | | **723** |

## Architecture

```
dsh-toolkit/
├── src/index.ts          # meta 包：相对路径动态导入 10 个子包 apply()，聚合注册
├── packages/dsh-tool-*   # vendored subpackages (pack-artifact snapshots; names remain @deepseek-ai/dsh-tool-*)
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

> Engineering adaptation of Plan A in the implementation document: the sub-packages are private Git/collection packages, so peer-name resolution is not feasible inside a profile;
> therefore the meta package uses **relative-path dynamic imports** (zero resolution magic, self-contained packaging); the sub-packages' runtime dependency
> (`@deepseek-ai/dsh-tools`) does not depend on the DSH monorepo in npm standalone mode (default); in monorepo mode it is resolved via each sub-package's own build-time junction.

## Installation

The repository lives at [omdsh-dev/dsh-toolkit](https://github.com/omdsh-dev/dsh-toolkit) (public).

### Standalone Bundle Model (Recommended)

Each sub-package can be independently installed, enabled, disabled, and uninstalled:

```sh
# 安装单个工具到 web profile
dsh plugin --profile web add github:omdsh-dev/dsh-tool-csv
# 一次性任务（headless）profile
dsh plugin --profile headless add github:omdsh-dev/dsh-tool-diff
```

Batch installation (collection helper scripts, idempotent — re-running does not add duplicates):

```sh
./scripts/install-web.sh       # 全部 10 工具 → web profile
./scripts/install-headless.sh  # 全部 10 工具 → headless profile（dsh run 使用面）
./scripts/install-all.sh       # 两个 profile 都装
```

Verify and run:

```sh
dsh --profile web --dump-config | grep tool-csv     # 行存在即安装成功
dsh run "使用 csv 工具解析 'a,b\n1,2'"               # headless 端到端
```

> ⚠️ web and headless are **different profiles**: installing to web does not automatically cover headless; `dsh run` uses headless by default.
> Windows paths use forward slashes (`C:/...`).

### Installing from an npm pack Tarball

Build locally and install from the tarball path (no GitHub dependency):

```sh
# tarball method (web shown; headless same)
npm pack
dsh plugin --profile web add <path to the npm pack tarball>
```

### Meta Bundle Model (Optional)

When all tools need to be mounted atomically in one shot, mount the root meta package:

```sh
dsh plugin --profile web add github:omdsh-dev/dsh-toolkit
dsh --profile web --dump-config | grep tool-kit
```

> ⚠️ If the profile has already individually mounted plugins with the same names (tool-time/.../tool-diff/tool-stat/tool-schema), mounting the meta package will fail with duplicate-name registration errors —
> in that case, remove the old plugins first, or use the standalone bundle model. meta apply is atomic (if any sub-plugin fails,
> already-registered tools are rolled back in reverse order, leaving no partial state).

### Manual Installation & Legacy Compatibility

Legacy scenarios: monorepo integration, legacy snapshots that do not support Profile Bundle, or plugin development/debugging environments (local junction/symlink, manually editing profile layers).

## Build & Test

**npm standalone mode (default, recommended)**: no DSH monorepo needed; after `npm install` (self-contained devDependencies):

```bash
npm run build:all           # 10 子包 + meta 包 tsc + 产物完整性验证（无 .ts 残留导入、10+1 个 lib/index.js）
bash scripts/test-all.sh    # 10 子包 vitest 全量（723 用例）；任一失败整体非零退出
npm pack                    # prepack 自包含（build:all），tarball 含 lib + 10 个子包
```

**Monorepo mode (optional: source contribution / legacy snapshots)**: explicitly provide the DSH monorepo root:

```bash
export DSH_MONOREPO=<DSH 0.1.0-rc.7 (npm) install path>   # 或作为第一个参数
bash scripts/build-all.sh   # link-deps + 10 子包 + meta 包 tsc + 产物完整性验证
bash scripts/test-all.sh
```

> `prepack` points to `build:all` (full build of the 10 sub-packages + meta), guaranteeing that the pack artifact contains all runtime entry points; the root Git entry is prebuilt from the current `src` and committed.
> This repository validates the build, tests, and pack artifact locally only; do not interpret that as an npm registry publication or as consumer/profile validation that was not run here.

## Syncing Vendored Packages (When Sub-repositories Are Updated)

Re-sync `packages/<name>` with the source repository (src/tests/package.json/tsconfig/cordis.patch.yml/LICENSE/README.md), and annotate the sub-package version in the README.

## Adding a New Tool

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md): copy the template sub-package → implement → test → build-all validation → update catalog.json.

## License

MIT
