#!/usr/bin/env bash
# 一键测试：跑 10 个子包的 vitest 套件。
# 审查 TK-04 修复：直接检查 vitest 退出码；任一子包失败则整体非零退出；
# 输出写入临时文件再解析（避免管道掩盖退出码）。
#
# 两种模式：npm 独立模式（默认，使用本仓库 node_modules 的 vitest）；
# monorepo 模式：显式提供 DSH_MONOREPO 环境变量或第一个参数。
set -euo pipefail

MONOREPO="${DSH_MONOREPO:-${1:-}}"
if [ -n "$MONOREPO" ]; then
  MONOREPO="$(printf '%s' "$MONOREPO" | sed -e 's|^/\([a-zA-Z]\)/|\u\1:/|' -e 's|\\|/|g' | sed 's|/$||')"
  VITEST="$MONOREPO/node_modules/vitest/vitest.mjs"
else
  VITEST="$(pwd)/node_modules/vitest/vitest.mjs"
fi
[ -f "$VITEST" ] || { echo "error: vitest not found (run npm install or set DSH_MONOREPO)" >&2; exit 2; }

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# 从 toolkit 根跑 vitest（--root）：子包 cwd 会被 monorepo 根配置拦截，
# root 指向本目录后 include（packages/*/tests/**/*.spec.ts）与 filter 均正确。
WD="$(pwd -W 2>/dev/null || pwd)"

TOTAL=0
FAILED=0
for P in packages/dsh-tool-*; do
  echo "== test $P"
  set +e
  node "$VITEST" run "$P" --root "$WD" >"$TMP" 2>&1
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
