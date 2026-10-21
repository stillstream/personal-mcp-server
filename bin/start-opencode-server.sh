#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
[[ -n "$OPENCODE_CLI_BIN" && -x "$OPENCODE_CLI_BIN" ]] || { echo "缺少 OpenCode v2 CLI" >&2; exit 2; }
[[ -s "$OPENCODE_PASSWORD_FILE" ]] || { echo "缺少 OpenCode 密码文件: $OPENCODE_PASSWORD_FILE" >&2; exit 2; }
exec python3 "$MCP_ROOT/bin/serve-supervisor-v2.py"
