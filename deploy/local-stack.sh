#!/usr/bin/env bash
# One local entrypoint for the Gateway, advisor MCP and OpenAI Tunnel client.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd -P)"
CONFIG=$(printenv AGENT_MCP_CONFIG || true)
if [ -z "$CONFIG" ]; then CONFIG="$ROOT/config/instance.local.json"; fi
BASE=$(printenv AGENT_MCP_HOME || true)
if [ -z "$BASE" ]; then BASE="$ROOT/.local"; fi
RELEASE=$(printenv AGENT_MCP_RELEASE || true)
if [ -z "$RELEASE" ]; then RELEASE="$ROOT"; fi
SERVICE="$ROOT/deploy/service.sh"
ADVISOR_STATE_DIR="$ROOT/.local/advisor"
ROLLBACK_DIR="$ROOT/.local/rollback"
CUTOVER_STARTED=0

load_config() {
  [ -r "$CONFIG" ] || { echo "Private instance config is not readable: $CONFIG" >&2; return 2; }
  {
    IFS= read -r -d '' ADVISOR_HOST
    IFS= read -r -d '' ADVISOR_PORT
    IFS= read -r -d '' ADVISOR_PATH
    IFS= read -r -d '' TUNNEL_HEALTH
    IFS= read -r -d '' TUNNEL_BINARY
    IFS= read -r -d '' TUNNEL_ID
    IFS= read -r -d '' API_KEY_FILE
    IFS= read -r -d '' ROOTS_JSON
    IFS= read -r -d '' ENABLED_OPERATIONS
    IFS= read -r -d '' GATEWAY_URL
    IFS= read -r -d '' MACHINE_ID
    IFS= read -r -d '' GATEWAY_HOST
    IFS= read -r -d '' GATEWAY_PORT
  } < <(node "$ROOT/components/advisor-mcp/src/config-cli.mjs" "$CONFIG")
  [ -n "$MACHINE_ID" ] && [ -n "$TUNNEL_ID" ] && [ -n "$API_KEY_FILE" ] || { echo 'Instance config lacks machine/Tunnel references' >&2; return 2; }
  export AGENT_MCP_CONFIG="$CONFIG"
}

active_advisor_release() {
  local pid_file pid cwd
  for pid_file in "$ADVISOR_STATE_DIR/mcp.pid" "$ADVISOR_STATE_DIR/tunnel.pid"; do
    [ -r "$pid_file" ] || continue
    pid="$(tr -dc '0-9' < "$pid_file")"
    [ -n "$pid" ] || continue
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ -n "$cwd" ] && [ -x "$cwd/start-openai-tunnel.sh" ] && [ -f "$cwd/src/server.mjs" ]; then
      readlink -f "$cwd/../.."
      return 0
    fi
  done
  return 1
}

verify_stack() {
  local gateway_state legacy_state active_release
  gateway_state="$(systemctl --user show agent-mcp.service -p ActiveState --value 2>/dev/null || true)"
  legacy_state="$(systemctl --user show agent-mcp-shadow.service -p ActiveState --value 2>/dev/null || true)"
  [ "$gateway_state" = active ] || { echo "Canonical Gateway is not active: $gateway_state" >&2; return 1; }
  [ "$legacy_state" != active ] && [ "$legacy_state" != activating ] || { echo "Legacy parallel Gateway remains active: $legacy_state" >&2; return 1; }
  active_release="$(active_advisor_release || true)"
  if [ -z "$active_release" ]; then active_release="$RELEASE"; fi
  if [ -L "$active_release" ]; then active_release="$(readlink -f "$active_release")"; fi
  [ -f "$active_release/deploy/verify-local-stack.mjs" ] || { echo "Active release verifier missing: $active_release" >&2; return 1; }
  AGENT_MCP_CONFIG="$CONFIG" node "$active_release/deploy/verify-local-stack.mjs"
}

preflight_stack() {
  local release="$1" legacy_state canonical_state
  if [ -L "$release" ]; then release="$(readlink -f "$release")"; fi
  [ -f "$release/src/server.mjs" ] && [ -f "$release/components/advisor-mcp/src/server.mjs" ] && [ -x "$release/components/tunnel-client/runtime/tunnel-client-runtime-cloudflared" ] || { echo "Unified release components missing: $release" >&2; return 2; }
  node "$release/deploy/validate-instance.mjs" "$CONFIG" "$release"
  legacy_state="$(systemctl --user show agent-mcp-shadow.service -p ActiveState --value 2>/dev/null || true)"
  canonical_state="$(systemctl --user show agent-mcp.service -p ActiveState --value 2>/dev/null || true)"
  if [ "$legacy_state" = active ]; then node "$ROOT/deploy/legacy-runtime-info.mjs" >/dev/null; fi
  printf 'PRECHECK_OK: source release and config valid; legacy service=%s, canonical service=%s\n' "$legacy_state" "$canonical_state"
}

start_stack() {
  local release="$1" advisor_script
  [ -f "$release/src/server.mjs" ] || { echo "Gateway release missing: $release" >&2; return 2; }
  advisor_script="$release/components/advisor-mcp/start-openai-tunnel.sh"
  [ -x "$advisor_script" ] || { echo "Advisor release script missing: $advisor_script" >&2; return 2; }
  "$SERVICE" start "$release" "$CONFIG"
  if ! AGENT_MCP_CONFIG="$CONFIG" "$advisor_script" up; then
    "$SERVICE" stop || true
    return 1
  fi
  verify_stack
}

stop_stack() {
  local state active_release advisor_script
  active_release="$(active_advisor_release || true)"
  if [ -z "$active_release" ]; then active_release="$RELEASE"; fi
  if [ -L "$active_release" ]; then active_release="$(readlink -f "$active_release")"; fi
  advisor_script="$active_release/components/advisor-mcp/start-openai-tunnel.sh"
  if [ -x "$advisor_script" ]; then AGENT_MCP_CONFIG="$CONFIG" "$advisor_script" down || true; fi
  state="$(systemctl --user show agent-mcp.service -p ActiveState --value 2>/dev/null || true)"
  if [ "$state" = active ] || [ "$state" = activating ]; then "$SERVICE" stop; fi
}

restore_legacy() {
  local release="$1" advisor_dir="$2" state_dir="$3" legacy_state
  stop_stack >/dev/null 2>&1 || true
  "$SERVICE" stop >/dev/null 2>&1 || true
  legacy_state="$(systemctl --user show agent-mcp-shadow.service -p ActiveState --value 2>/dev/null || true)"
  if [ "$legacy_state" != active ] && [ -f "$release/src/server.mjs" ]; then "$SERVICE" start "$release" "$CONFIG" >/dev/null 2>&1 || true; fi
  if [ -x "$advisor_dir/start-openai-tunnel.sh" ]; then
    env -u AGENT_MCP_CONFIG AGENT_MCP_GATEWAY_CLIENT_CONFIG="$HOME/.config/agent-mcp/shadow/chatgpt.client.json" CONTROL_PLANE_TUNNEL_ID="$TUNNEL_ID" CONTROL_PLANE_API_KEY_FILE="$API_KEY_FILE" MCP_TUNNEL_STATE_DIR="$state_dir" "$advisor_dir/start-openai-tunnel.sh" up >/dev/null 2>&1 || true
  fi
}

rollback_on_failure() {
  local rc="$1"
  trap - EXIT
  if [ "$rc" -ne 0 ] && [ "$CUTOVER_STARTED" -eq 1 ]; then
    echo 'Local cutover failed; attempting rollback to the previous release and advisor service.' >&2
    restore_legacy "$LEGACY_RELEASE" "$LEGACY_ADVISOR_DIR" "$LEGACY_STATE_DIR"
  fi
  exit "$rc"
}

save_manifest() {
  local manifest="$1" old_release="$2" old_config="$3" old_advisor="$4" old_state="$5" new_release="$6"
  mkdir -p "$ROLLBACK_DIR"
  chmod 700 "$ROLLBACK_DIR"
  python3 - "$manifest" "$old_release" "$old_config" "$old_advisor" "$old_state" "$CONFIG" "$new_release" <<'PY'
import json, os, sys, time
path, old_release, old_config, old_advisor, old_state, new_config, new_release = sys.argv[1:]
data = {'captured_at': int(time.time()), 'legacy_release': old_release, 'legacy_config': old_config, 'legacy_advisor_dir': old_advisor, 'legacy_state_dir': old_state, 'canonical_config': new_config, 'canonical_release': new_release}
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w', encoding='utf-8') as stream:
    json.dump(data, stream, indent=2)
    stream.write('\\n')
os.chmod(path, 0o600)
PY
}

cutover_stack() {
  local release="$1" stamp manifest
  load_config
  [ -f "$release/src/server.mjs" ] || { echo "Gateway release missing: $release" >&2; return 2; }
  {
    IFS= read -r -d '' LEGACY_RELEASE
    IFS= read -r -d '' LEGACY_CONFIG
    IFS= read -r -d '' LEGACY_ADVISOR_DIR
    IFS= read -r -d '' LEGACY_STATE_DIR
  } < <(node "$ROOT/deploy/legacy-runtime-info.mjs" --nul)
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  manifest="$ROLLBACK_DIR/local-stack-$stamp.json"
  save_manifest "$manifest" "$LEGACY_RELEASE" "$LEGACY_CONFIG" "$LEGACY_ADVISOR_DIR" "$LEGACY_STATE_DIR" "$release"
  CUTOVER_STARTED=1
  trap 'rollback_on_failure "$?"' EXIT
  MCP_TUNNEL_STATE_DIR="$LEGACY_STATE_DIR" "$LEGACY_ADVISOR_DIR/start-openai-tunnel.sh" down
  "$SERVICE" stop-legacy
  start_stack "$release"
  CUTOVER_STARTED=0
  trap - EXIT
  echo "LOCAL_CUTOVER_OK: canonical Gateway/advisor/Tunnel are active; existing Tunnel ID retained. Rollback metadata: $manifest"
}

rollback_stack() {
  local manifest="$1"
  [ -r "$manifest" ] || { echo 'Rollback manifest is not readable' >&2; return 2; }
  load_config
  {
    IFS= read -r -d '' LEGACY_RELEASE
    IFS= read -r -d '' LEGACY_CONFIG
    IFS= read -r -d '' LEGACY_ADVISOR_DIR
    IFS= read -r -d '' LEGACY_STATE_DIR
  } < <(node "$ROOT/deploy/legacy-runtime-info.mjs" --manifest "$manifest" --nul)
  restore_legacy "$LEGACY_RELEASE" "$LEGACY_ADVISOR_DIR" "$LEGACY_STATE_DIR"
  verify_stack
  echo 'ROLLBACK_OK: previous Gateway code restored under the canonical local service name.'
}

if [ "$#" -lt 1 ]; then echo 'usage: local-stack.sh preflight [release]|start|stop|status|verify|cutover [release]|rollback <manifest>' >&2; exit 2; fi
cmd="$1"
case "$cmd" in
  preflight)
    load_config
    release="$RELEASE"
    if [ "$#" -ge 2 ]; then release="$2"; fi
    preflight_stack "$release"
    ;;
  start)
    load_config
    if [ -L "$RELEASE" ]; then RELEASE="$(readlink -f "$RELEASE")"; fi
    start_stack "$RELEASE"
    ;;
  stop)
    load_config
    stop_stack
    ;;
  status|verify)
    load_config
    verify_stack
    ;;
  cutover)
    release="$RELEASE"
    if [ "$#" -ge 2 ]; then release="$2"; fi
    if [ -L "$release" ]; then release="$(readlink -f "$release")"; fi
    cutover_stack "$release"
    ;;
  rollback)
    if [ "$#" -lt 2 ]; then echo 'usage: local-stack.sh rollback <manifest>' >&2; exit 2; fi
    rollback_stack "$2"
    ;;
  *) echo 'usage: local-stack.sh preflight [release]|start|stop|status|verify|cutover [release]|rollback <manifest>' >&2; exit 2 ;;
esac
