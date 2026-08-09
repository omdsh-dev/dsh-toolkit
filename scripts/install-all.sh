#!/bin/sh
# 安装到全部 profile（web + headless）。
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)

"$root/scripts/install-web.sh" web
"$root/scripts/install-headless.sh" headless
