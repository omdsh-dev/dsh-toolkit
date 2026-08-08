#!/bin/sh
# 建立构建期依赖解析链（Windows：PowerShell Junction；Unix：symlink）。
#
# 前置条件（审查 TK-02 修复）：必须显式提供 DSH monorepo 路径——
#   DSH_MONOREPO 环境变量或第一个参数；不再内置本机默认值。
# 例：DSH_MONOREPO=/c/Users/admin/.dsh/source/staging-20260808T121140Z ./scripts/link-deps.sh
set -eu

MONOREPO="${DSH_MONOREPO:-${1:-}}"
if [ -z "$MONOREPO" ]; then
  echo "error: DSH_MONOREPO (env or \$1) is required — point it at the dsh source tree root" >&2
  exit 2
fi
# 规范化并验证
MONOREPO="$(printf '%s' "$MONOREPO" | sed -e 's|^/\([a-zA-Z]\)/|\u\1:/|' -e 's|\\|/|g' | sed 's|/$||')"
[ -d "$MONOREPO/packages/core/tools" ] || { echo "error: not a dsh monorepo root: $MONOREPO" >&2; exit 2; }

WD="$(pwd -W 2>/dev/null || pwd)"

mkdir -p node_modules/@deepseek-ai node_modules/@types
for P in packages/dsh-tool-*; do
  mkdir -p "$P/node_modules/@deepseek-ai" "$P/node_modules/@types"
done

# 动态解析 @types/node（不硬编码 pnpm 内部版本；取最高版本，找不到则警告）
NODE_TYPES="$(ls -d "$MONOREPO"/node_modules/.pnpm/@types+node@*/node_modules/@types/node 2>/dev/null | sort -V | tail -1 || true)"

if command -v powershell >/dev/null 2>&1; then
  link() { # $1=dir $2=name $3=target
    powershell -NoProfile -Command "if (-not (Test-Path '$WD/$1/node_modules/$2')) { New-Item -ItemType Junction -Path '$WD/$1/node_modules/$2' -Target '$3' | Out-Null }"
  }
else
  link() { ln -sfn "$3" "$WD/$1/node_modules/$2"; }
fi

for P in packages/dsh-tool-*; do
  link "$P" "cordis" "$MONOREPO/vendor/cordis"
  link "$P" "@deepseek-ai/dsh-tools" "$MONOREPO/packages/core/tools"
done
link "." "cordis" "$MONOREPO/vendor/cordis"
link "." "@deepseek-ai/dsh-tools" "$MONOREPO/packages/core/tools"
if [ -n "$NODE_TYPES" ]; then
  link "." "@types/node" "$NODE_TYPES"
else
  echo "warning: @types/node not found under $MONOREPO/node_modules/.pnpm — subpackages using Buffer will not type-check" >&2
fi
echo "link-deps: done (monorepo=$MONOREPO)"
