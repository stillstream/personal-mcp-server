#!/usr/bin/env bash
set -euo pipefail
umask 077
ROOT="$HOME/.local/share/opencode-mcp"
: "${CHATGPT_TUNNEL_ID:?Set CHATGPT_TUNNEL_ID in tunnel service environment}"
KEY_FILE="$ROOT/runtime/control-plane-api-key"
IFS= read -r token < "$ROOT/runtime/access-token"
printf 'Bearer %s' "$token" > "$ROOT/runtime/authorization"
unset token
chmod 600 "$ROOT/runtime/authorization"
exec "$ROOT/bin/tunnel-client-v0.0.14/tunnel-client-runtime-cloudflared" run \
  --control-plane.tunnel-id "$CHATGPT_TUNNEL_ID" \
  --control-plane.api-key "file:$KEY_FILE" \
  --mcp.server-url url=http://127.0.0.1:18878/mcp \
  --mcp.extra-headers "Authorization: file:$ROOT/runtime/authorization" \
  --mcp.discovery-extra-headers "Authorization: file:$ROOT/runtime/authorization" \
  --health.listen-addr 127.0.0.1:38437 --log.level info
