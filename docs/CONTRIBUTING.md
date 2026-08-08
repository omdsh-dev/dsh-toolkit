# 新增工具流程（CONTRIBUTING）

1. **实现**：复制 `packages/dsh-tool-csv` 作为模板（脚手架 + src + tests + README），
   按各实施文档的踩坑清单完成（tsconfig 三件套、cordis 解析 junction、`csv:` 前缀错误约定）。
2. **构建**：`bash scripts/build-all.sh`（自动 link-deps + tsc 全部子包）。
3. **测试**：`bash scripts/test-all.sh`（跑全部子包 vitest 套件，合计用例数须与 README 标注一致）。
4. **验证**：`dsh --profile web --dump-config | grep tool-<name>`。
5. **更新**：把新子包登记进根 `catalog.json` 的 `plugins` 与 README 工具表。
6. **同步 vendored**（子仓库有更新时）：把 `packages/<name>` 的内容与源仓库重新同步
   （复制 src/tests/package.json/tsconfig.json/cordis.patch.yml/LICENSE/README.md），
   并在 README 标注子包版本。
