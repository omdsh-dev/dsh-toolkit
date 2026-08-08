#!/bin/sh
# 一键挂载到 profile（web/headless）。
# 注意：本 collection 聚合注册 6 个工具——若 profile 已单独挂载过同名插件，
# 需先移除（工具注册重名会报错）。
set -eu
PROFILE="${1:-web}"
E="$(pwd)"
dsh plugin --profile "$PROFILE" add "$E"
echo "验证："
dsh --profile "$PROFILE" --dump-config | grep -A2 "tool-kit"
