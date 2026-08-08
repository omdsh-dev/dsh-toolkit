#!/bin/sh
# 一键挂载到 profile（审查 TK-03 修复：真正实现 meta / 逐包两种模式）。
#
# 用法: ./scripts/install.sh <profile> [meta|all]
#   meta（默认）: 只挂载根 meta 包（tool-kit 一行）
#   all         : 逐个挂载 packages/dsh-tool-*（方式 B；与已有独立插件共存时用）
#   -n          前置 dry-run（只打印要执行的命令）
set -eu

PROFILE="${1:-web}"
MODE="${2:-meta}"
E="$(pwd)"

if [ "$MODE" = "all" ]; then
  for P in packages/dsh-tool-*; do
    echo "dsh plugin --profile $PROFILE add $E/$P"
    if [ "${DRY_RUN:-0}" != "1" ]; then
      dsh plugin --profile "$PROFILE" add "$E/$P" >/dev/null
    fi
  done
  echo "验证："
  dsh --profile "$PROFILE" --dump-config | grep -E "tool-(time|encoding|json|calculator|csv|regex|markdown)" | sort -u
elif [ "$MODE" = "meta" ]; then
  echo "dsh plugin --profile $PROFILE add $E"
  if [ "${DRY_RUN:-0}" != "1" ]; then
    dsh plugin --profile "$PROFILE" add "$E"
  fi
  echo "验证："
  dsh --profile "$PROFILE" --dump-config | grep -A2 "tool-kit"
else
  echo "error: MODE must be meta|all" >&2
  exit 2
fi
