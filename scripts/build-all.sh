#!/bin/sh
# 一键构建：10 个子包 + meta 包（tsc），并验证产物完整性（审查 TK-01/TK-07）。
#
# 两种模式：
# - npm 独立模式（默认）：使用本仓库 node_modules 的 typescript（npm install 后即可用，无 DSH_MONOREPO）；
# - monorepo 模式：显式提供 DSH_MONOREPO 环境变量或第一个参数（见 link-deps.sh）。
set -eu
MONOREPO="${DSH_MONOREPO:-${1:-}}"
if [ -n "$MONOREPO" ]; then
  TSC_ROOT="$(printf '%s' "$MONOREPO" | sed -e 's|^/\([a-zA-Z]\)/|\u\1:/|' -e 's|\\|/|g' | sed 's|/$||')/node_modules/typescript/bin/tsc"
  ./scripts/link-deps.sh "${MONOREPO}" >/dev/null
else
  TSC_ROOT="$(pwd)/node_modules/typescript/bin/tsc"
  [ -f "$TSC_ROOT" ] || { echo "error: node_modules/typescript missing — run npm install first" >&2; exit 2; }
fi

for P in packages/dsh-tool-*; do
  echo "== build $P"
  (cd "$P" && node "$TSC_ROOT" -p tsconfig.json) || exit 1
done
echo "== build meta (dsh-toolkit)"
node "$TSC_ROOT" -p tsconfig.json || exit 1

# 产物完整性验证（TK-01/TK-07）：
# 1) 根 + 9 个子包的 lib/index.js 必须存在
EXPECTED="packages/dsh-tool-calculator packages/dsh-tool-csv packages/dsh-tool-diff packages/dsh-tool-encoding packages/dsh-tool-json packages/dsh-tool-markdown packages/dsh-tool-regex packages/dsh-tool-time packages/dsh-tool-stat packages/dsh-tool-schema"
for P in $EXPECTED; do
  [ -f "$P/lib/index.js" ] || { echo "error: missing $P/lib/index.js" >&2; exit 1; }
done
[ -f "lib/index.js" ] || { echo "error: missing meta lib/index.js" >&2; exit 1; }
# 2) 产物中不得残留 .ts 相对导入
if grep -rEn 'from "\./[^"]*\.ts"|import\("[^"]*\.ts"\)' "$EXPECTED" lib 2>/dev/null; then
  echo "error: .ts imports left in build output" >&2
  exit 1
fi
echo "ok: 10 个子包 + meta 包构建完成，产物完整"
