#!/bin/sh
# 一键测试：跑 6 个子包的 vitest 套件。
set -eu
ROOT_DIR="${1:-/c/Users/admin/.dsh/source/staging-20260808T121140Z}"
MONOREPO="$(printf '%s' "$ROOT_DIR" | sed -e 's|^/\([a-zA-Z]\)/|\u\1:/|' -e 's|\\|/|g')"
VITEST="$MONOREPO/node_modules/vitest/vitest.mjs"

TOTAL=0
for P in packages/dsh-tool-*; do
  echo "== test $P"
  OUT=$(cd "$P" && node "$VITEST" run tests 2>&1 | grep -E 'Test Files|Tests |no tests')
  echo "$OUT"
  N=$(echo "$OUT" | sed -nE 's/.*Tests  +([0-9]+) passed.*/\1/p' | head -1)
  [ -n "$N" ] && TOTAL=$((TOTAL + N))
done
echo "== 合计用例数: $TOTAL"
