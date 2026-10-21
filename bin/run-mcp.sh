#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
case "${1:-local}" in
  local) export MCP_HOST=127.0.0.1 ;;
  lan) export MCP_HOST=0.0.0.0; export MCP_PORT="$MCP_LAN_PORT" ;;
  *) echo "Usage: run-mcp.sh [local|lan]" >&2; exit 2 ;;
esac
exec node "$MCP_ROOT/src/server.mjs"
