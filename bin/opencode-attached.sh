#!/usr/bin/env bash
# Optional shortcut for connecting to the local OpenCode v2 HTTP service.
set -euo pipefail
source "$(dirname "$0")/common.sh"
[[ -n "$OPENCODE_CLI_BIN" && -x "$OPENCODE_CLI_BIN" ]] || { echo "未安装 OpenCode CLI" >&2; exit 2; }
exec "$OPENCODE_CLI_BIN" run --server "http://127.0.0.1:$OPENCODE_PORT" "$@"
