#!/usr/bin/env bash
# 一键测试：跑 7 个子包的 vitest 套件。
# 审查 TK-04 修复：直接检查 vitest 退出码；任一子包失败则整体非零退出；
# 输出写入临时文件再解析（避免管道掩盖退出码）。
#
# 前置条件：DSH_MONOREPO 环境变量或第一个参数。
set -euo pipefail

MONOREPO="${DSH_MONOREPO:-${1:-}}"
if [ -z "$MONOREPO" ]; then
  echo "error: DSH_MONOREPO (env or \$1) is required" >&2
  exit 2
fi
MONOREPO="$(printf '%s' "$MONOREPO" | sed -e 's|^/\([a-zA-Z]\)/|\u\1:/|' -e 's|\\|/|g' | sed 's|/$||')"
VITEST="$MONOREPO/node_modules/vitest/vitest.mjs"
[ -f "$VITEST" ] || { echo "error: vitest not found under $MONOREPO" >&2; exit 2; }

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

TOTAL=0
FAILED=0
for P in packages/dsh-tool-*; do
  echo "== test $P"
  set +e
  (cd "$P" && node "$VITEST" run tests) >"$TMP" 2>&1
  RC=$?
  set -e
  grep -E 'Test Files|Tests ' "$TMP" || true
  PASSED=$(sed -nE 's/.*Tests  +([0-9]+) passed.*/\1/p' "$TMP" | head -1)
  FAILCOUNT=$(sed -nE 's/.*([0-9]+) failed.*/\1/p' "$TMP" | head -1)
  if [ $RC -ne 0 ] || { [ -n "$FAILCOUNT" ] && [ "$FAILCOUNT" -ne 0 ]; }; then
    echo "!! $P FAILED (exit=$RC failed=$FAILCOUNT)" >&2
    grep -E 'FAIL |×' "$TMP" | head -10 >&2 || true
    FAILED=1
  fi
  if [ -n "$PASSED" ]; then TOTAL=$((TOTAL + PASSED)); fi
done

echo "== 合计通过用例数: $TOTAL"
if [ "$FAILED" -ne 0 ]; then
  echo "== 存在失败子包，整体失败" >&2
  exit 1
fi
