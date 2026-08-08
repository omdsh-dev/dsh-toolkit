#!/bin/sh
# 一键构建：6 个子包 + meta 包（tsc），验证产物相对导入为 .js。
set -eu
ROOT_DIR="${1:-/c/Users/admin/.dsh/source/staging-20260808T121140Z}"
MONOREPO="$(printf '%s' "$ROOT_DIR" | sed -e 's|^/\([a-zA-Z]\)/|\u\1:/|' -e 's|\\|/|g')"
TSC="$MONOREPO/node_modules/typescript/bin/tsc"

./scripts/link-deps.sh "$ROOT_DIR" >/dev/null

for P in packages/dsh-tool-*; do
  echo "== build $P"
  (cd "$P" && node "$TSC" -p tsconfig.json) || exit 1
done
echo "== build meta (dsh-toolkit)"
node "$TSC" -p tsconfig.json || exit 1

COUNT=$(ls packages/*/lib/index.js | wc -l)
echo "ok: $COUNT 个子包 + meta 包构建完成"
grep -l 'from "./' packages/*/lib/index.js >/dev/null 2>&1 || true
