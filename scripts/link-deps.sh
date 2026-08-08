#!/bin/sh
# 建立构建期依赖解析链（Windows：PowerShell Junction；Unix：symlink）。
# 每个子包与 meta 包需要 cordis / dsh-tools（@types/node 按需）。
set -eu
ROOT_DIR="${1:-/c/Users/admin/.dsh/source/staging-20260808T121140Z}"
WD="$(pwd -W 2>/dev/null || pwd)"
MONOREPO="$(printf '%s' "$ROOT_DIR" | sed -e 's|^/\([a-zA-Z]\)/|\u\1:/|' -e 's|\\|/|g')"

mkdir -p node_modules/@deepseek-ai node_modules/@types
for P in packages/dsh-tool-*; do
  mkdir -p "$P/node_modules/@deepseek-ai" "$P/node_modules/@types"
done

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
link "." "@types/node" "$MONOREPO/node_modules/.pnpm/@types+node@22.20.0/node_modules/@types/node"
echo "link-deps: done (monorepo=$MONOREPO)"
