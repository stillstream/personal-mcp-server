#!/usr/bin/env bash
set -euo pipefail
ref="${1:?git ref required}"; instance="${2:?absolute instance path required}"
[[ "$instance" = /* && -f "$instance" ]] || { echo 'private instance missing' >&2; exit 2; }
repo="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
commit="$(git -C "$repo" rev-parse --verify "$ref^{commit}")"
base="${AGENT_MCP_HOME:-$HOME/.local/share/agent-mcp}"
umask 077; mkdir -p "$base/releases"
release="$base/releases/$commit"
if [[ ! -d "$release" ]]; then
 stage="$(mktemp -d "$base/releases/.stage-XXXXXX")"
 trap 'rm -rf -- "$stage"' EXIT
 git -C "$repo" archive "$commit" | tar -x -C "$stage"
 (cd "$stage"; npm ci --ignore-scripts --no-audit --no-fund; npm test)
 mv "$stage" "$release"; trap - EXIT
fi
printf '%s\n' "$release"
echo "Prepared release only. Start the unified stack with deploy/local-stack.sh after local preflight; no service or Tunnel was changed."
