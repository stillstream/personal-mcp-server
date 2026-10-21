#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/common.sh"
[[ -n "$CHATGPT_TUNNEL_ID" ]] || { echo "配置 CHATGPT_TUNNEL_ID 后才能启动隧道" >&2; exit 2; }
[[ -s "$CONTROL_PLANE_KEY_FILE" ]] || { echo "缺少 Tunnel API Key 文件: $CONTROL_PLANE_KEY_FILE" >&2; exit 2; }
[[ -x "$TUNNEL_CLIENT_BIN" ]] || { echo "缺少 Tunnel Client: $TUNNEL_CLIENT_BIN" >&2; exit 2; }
[[ -s "$MCP_TOKEN_FILE" ]] || { echo "缺少 MCP Token: $MCP_TOKEN_FILE" >&2; exit 2; }
# MCP 在本机运行；隧道的远程控制面保持独立注册。
auth_file="$MCP_ROOT/runtime/authorization"
token="$(cat "$MCP_TOKEN_FILE")"
printf 'Bearer %s' "$token" > "$auth_file"
unset token
chmod 600 "$auth_file"
exec "$TUNNEL_CLIENT_BIN" run \
  --control-plane.tunnel-id "$CHATGPT_TUNNEL_ID" \
  --control-plane.api-key "file:$CONTROL_PLANE_KEY_FILE" \
  --mcp.server-url "url=http://127.0.0.1:${MCP_PORT}/mcp" \
  --mcp.extra-headers "Authorization: file:$auth_file" \
  --mcp.discovery-extra-headers "Authorization: file:$auth_file" \
  --health.listen-addr "127.0.0.1:${TUNNEL_HEALTH_PORT}" \
  --log.level info
