#!/usr/bin/env bash
set -euo pipefail
base="${AGENT_MCP_HOME:-$HOME/.local/share/agent-mcp}"
bash "$(dirname "$0")/install.sh" "${1:?ref}" "${2:?instance}"
repo="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
commit="$(git -C "$repo" rev-parse --verify "$1^{commit}")"
if [[ -L "$base/current" ]]; then readlink "$base/current" > "$base/previous"; fi
ln -s "$base/releases/$commit" "$base/.current-next"
mv -Tf "$base/.current-next" "$base/current"
echo 'Prepared current pointer only; services and Tunnel unchanged. Use deploy/local-stack.sh cutover for the approved local entrypoint switch.'
