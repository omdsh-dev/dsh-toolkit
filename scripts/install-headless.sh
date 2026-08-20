#!/bin/sh
# 把 collection 内全部工具 bundle 安装到 headless profile（dsh run 使用面）。
set -eu

profile="${1:-headless}"
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

for plugin in "$root"/packages/dsh-tool-*; do
  [ -d "$plugin" ] || continue
  dsh plugin --profile "$profile" add "$plugin"
done

dsh --profile "$profile" --dump-config \
  | grep -E 'tool-time|tool-encoding|tool-json|tool-calculator|tool-csv|tool-regex|tool-markdown|tool-diff|tool-stat|tool-schema'
