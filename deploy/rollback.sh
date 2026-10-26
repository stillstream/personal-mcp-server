#!/usr/bin/env bash
set -euo pipefail
base="${AGENT_MCP_HOME:-$HOME/.local/share/agent-mcp}"
[[ -f "$base/previous" ]] || { echo 'no recorded previous release' >&2; exit 2; }
read -r previous < "$base/previous"
[[ "$previous" = "$base/releases/"* && -d "$previous" ]] || { echo 'invalid release' >&2; exit 2; }
ln -s "$previous" "$base/.rollback-next"; mv -Tf "$base/.rollback-next" "$base/current"
echo 'Release pointer restored only. Use deploy/local-stack.sh rollback <manifest> to restore a previously active local stack.'
