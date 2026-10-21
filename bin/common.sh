#!/usr/bin/env bash
# All deployed scripts share the same per-user settings, independent of Linux username.
set -euo pipefail
umask 077
MCP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DEPLOY_CONFIG="${PERSONAL_MCP_CONFIG:-$HOME/.config/personal-mcp-server/deploy.env}"
if [[ -f "$DEPLOY_CONFIG" ]]; then
  # Local trusted config, never committed. Only simple shell assignments are needed.
  # shellcheck disable=SC1090
  source "$DEPLOY_CONFIG"
fi
export PATH="$MCP_ROOT/opt/node-v22.19.0/bin:$HOME/.local/bin:$PATH"
MCP_PORT="${MCP_PORT:-18878}"
MCP_LAN_PORT="${MCP_LAN_PORT:-18879}"
MCP_TOOL_PREFIX="${MCP_TOOL_PREFIX:-s100}"
MCP_TOKEN_FILE="${MCP_TOKEN_FILE:-$MCP_ROOT/runtime/access-token}"
OPENCODE_VERSION="${OPENCODE_VERSION:-2.0.32}"
OPENCODE_HOST="${OPENCODE_HOST:-127.0.0.1}"
OPENCODE_PORT="${OPENCODE_PORT:-4096}"
OPENCODE_PASSWORD_FILE="${OPENCODE_PASSWORD_FILE:-$MCP_ROOT/runtime/opencode-password}"
OPENCODE_CLI_BIN="${OPENCODE_CLI_BIN:-}"
if [[ -z "$OPENCODE_CLI_BIN" ]]; then
  if [[ -x "$MCP_ROOT/opt/opencode/node_modules/.bin/opencode" ]]; then
    OPENCODE_CLI_BIN="$MCP_ROOT/opt/opencode/node_modules/.bin/opencode"
  elif command -v opencode >/dev/null 2>&1; then
    OPENCODE_CLI_BIN="$(command -v opencode)"
  fi
fi
TUNNEL_VERSION="${TUNNEL_VERSION:-v0.0.14}"
CHATGPT_TUNNEL_ID="${CHATGPT_TUNNEL_ID:-}"
TUNNEL_HEALTH_PORT="${TUNNEL_HEALTH_PORT:-38437}"
TUNNEL_CLIENT_BIN="${TUNNEL_CLIENT_BIN:-$MCP_ROOT/bin/tunnel-client-${TUNNEL_VERSION}/tunnel-client-runtime-cloudflared}"
CONTROL_PLANE_KEY_FILE="${CONTROL_PLANE_KEY_FILE:-$MCP_ROOT/runtime/control-plane-api-key}"
export MCP_ROOT DEPLOY_CONFIG MCP_PORT MCP_LAN_PORT MCP_TOOL_PREFIX MCP_TOKEN_FILE
export OPENCODE_VERSION OPENCODE_HOST OPENCODE_PORT OPENCODE_PASSWORD_FILE OPENCODE_CLI_BIN
export TUNNEL_VERSION CHATGPT_TUNNEL_ID TUNNEL_HEALTH_PORT TUNNEL_CLIENT_BIN CONTROL_PLANE_KEY_FILE
