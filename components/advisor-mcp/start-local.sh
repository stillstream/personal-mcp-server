#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
config="$(printenv AGENT_MCP_CONFIG || true)"
if [ -z "$config" ]; then config="$PWD/../../config/instance.local.json"; fi
[ -r "$config" ] || { echo 'Private AGENT_MCP_CONFIG is required' >&2; exit 2; }
export AGENT_MCP_CONFIG="$config"
export MCP_ALLOW_UNAUTH_LOCAL=1
exec npm start
