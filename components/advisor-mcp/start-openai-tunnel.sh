#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"

# One private instance file controls Gateway, advisor roots, caller level and Tunnel references.
AGENT_MCP_CONFIG="${AGENT_MCP_CONFIG:-$PWD/../../config/instance.local.json}"
[ -r "$AGENT_MCP_CONFIG" ] || { echo "AGENT_MCP_CONFIG is not readable: $AGENT_MCP_CONFIG" >&2; exit 2; }
export AGENT_MCP_CONFIG
mapfile -d "" -t INSTANCE_VALUES < <(node src/config-cli.mjs "$AGENT_MCP_CONFIG")
[ "${#INSTANCE_VALUES[@]}" -eq 13 ] || { echo "Unable to load advisor settings from AGENT_MCP_CONFIG" >&2; exit 2; }
MCP_HOST="${INSTANCE_VALUES[0]}"
MCP_PORT="${INSTANCE_VALUES[1]}"
MCP_PATH="${INSTANCE_VALUES[2]}"
HEALTH_ADDR="${INSTANCE_VALUES[3]}"
TUNNEL_CLIENT="${INSTANCE_VALUES[4]}"
CONTROL_PLANE_TUNNEL_ID="${INSTANCE_VALUES[5]}"
CONTROL_PLANE_API_KEY_FILE="${INSTANCE_VALUES[6]}"
MCP_ROOTS_JSON="${INSTANCE_VALUES[7]}"
MCP_ENABLED_OPERATIONS="${INSTANCE_VALUES[8]}"
export MCP_HOST MCP_PORT MCP_PATH MCP_ALLOW_UNAUTH_LOCAL=1 MCP_ROOTS_JSON MCP_ENABLED_OPERATIONS CONTROL_PLANE_TUNNEL_ID CONTROL_PLANE_API_KEY_FILE
STATE_DIR="${MCP_TUNNEL_STATE_DIR:-$PWD/../../.local/advisor}"
SERVER_PID_FILE="$STATE_DIR/mcp.pid"
TUNNEL_PID_FILE="$STATE_DIR/tunnel.pid"
CLIENT_FILE="$STATE_DIR/tunnel-client.path"
LOG_DIR="$STATE_DIR/logs"
HEALTH_PORT="${HEALTH_ADDR##*:}"

mkdir -p "$STATE_DIR" "$LOG_DIR"
chmod 700 "$STATE_DIR" "$LOG_DIR"

need_credentials() {
  : "${CONTROL_PLANE_TUNNEL_ID:?Export CONTROL_PLANE_TUNNEL_ID before running up}"
  if [ -n "${CONTROL_PLANE_API_KEY_FILE:-}" ]; then
    [ -r "$CONTROL_PLANE_API_KEY_FILE" ] || { echo 'CONTROL_PLANE_API_KEY_FILE is not readable' >&2; return 2; }
    api_key_ref="file:$CONTROL_PLANE_API_KEY_FILE"
  else
    echo 'Set existing_tunnel.api_key or api_key_file in the project instance' >&2
    return 2
  fi
  [ -x "$TUNNEL_CLIENT" ] || { printf 'Tunnel client is not executable: %s\n' "$TUNNEL_CLIENT" >&2; return 2; }
}

proc_cwd() { readlink -f "/proc/$1/cwd" 2>/dev/null || true; }
proc_cmd() { tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || true; }
proc_env_value() {
  python3 - "$1" "$2" <<'PY'
import sys
pid, key = sys.argv[1], sys.argv[2].encode() + b'='
try:
    with open(f'/proc/{pid}/environ', 'rb') as stream:
        for item in stream.read().split(b'\0'):
            if item.startswith(key):
                sys.stdout.write(item[len(key):].decode())
                break
except OSError:
    pass
PY
}
is_our_mcp() {
  [ "$(proc_cwd "$1")" = "$PWD" ] && [[ "$(proc_cmd "$1")" == *"src/server.mjs"* ]]
}
is_our_tunnel() {
  local cmd
  cmd=$(proc_cmd "$1")
  [[ "$cmd" == *"$TUNNEL_CLIENT run"* ]] && [[ "$cmd" == *"--control-plane.tunnel-id"* ]]
}

listener_pids() {
  local port="$1"
  ss -ltnp "( sport = :$port )" 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u || true
}
stop_pid() {
  local pid="$1" kind="$2" i
  if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
  if [ "$kind" = mcp ]; then
    is_our_mcp "$pid" || { echo "Refusing to stop unrelated PID $pid on MCP port" >&2; return 1; }
  else
    is_our_tunnel "$pid" || { echo "Refusing to stop unrelated PID $pid on tunnel health port" >&2; return 1; }
  fi
  kill -TERM "$pid" 2>/dev/null || true
  for i in $(seq 1 50); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.1
  done
  echo "Process $pid did not stop gracefully; sending SIGKILL" >&2
  kill -KILL "$pid" 2>/dev/null || true
}

read_pid() { [ -s "$1" ] && tr -dc '0-9' < "$1" || true; }
proc_env_value() {
  python3 - "$1" "$2" <<'PY'
import sys
pid, key = sys.argv[1], sys.argv[2].encode() + b'='
try:
    with open('/proc/' + pid + '/environ', 'rb') as stream:
        for item in stream.read().split(bytes([0])):
            if item.startswith(key):
                sys.stdout.write(item[len(key):].decode())
                break
except OSError:
    pass
PY
}
reload_mcp() {
  local old_mcp old_tunnel old_token old_max new_pid ready
  old_mcp=$(read_pid "$SERVER_PID_FILE")
  old_tunnel=$(read_pid "$TUNNEL_PID_FILE")
  if [ -z "$old_mcp" ] || ! kill -0 "$old_mcp" 2>/dev/null || ! is_our_mcp "$old_mcp"; then
    echo 'Refusing MCP-only reload: no owned advisor MCP process is recorded' >&2
    return 1
  fi
  if [ -z "$old_tunnel" ] || ! kill -0 "$old_tunnel" 2>/dev/null || ! is_our_tunnel "$old_tunnel"; then
    echo 'Refusing MCP-only reload: the existing tunnel process is not verified' >&2
    return 1
  fi
  if [ -z "$AGENT_MCP_CONFIG" ] || [ ! -r "$AGENT_MCP_CONFIG" ]; then
    echo 'Refusing MCP-only reload: server1 Gateway client reference is unavailable' >&2
    return 1
  fi
  if ! curl -fsS "http://$HEALTH_ADDR/readyz" >/dev/null 2>&1; then
    echo 'Refusing MCP-only reload: existing tunnel is not ready' >&2
    return 1
  fi
  old_max=$(proc_env_value "$old_mcp" MCP_MAX_READ_BYTES)
  # Auth always comes from the same caller in the private project instance.
  export AGENT_MCP_CONFIG MCP_ROOTS_JSON MCP_ENABLED_OPERATIONS MCP_HOST MCP_PORT MCP_PATH MCP_ALLOW_UNAUTH_LOCAL
  [ -z "$old_max" ] || export MCP_MAX_READ_BYTES="$old_max"
  stop_pid "$old_mcp" mcp || return 1
  rm -f "$SERVER_PID_FILE"
  if pids=$(listener_pids "$MCP_PORT"); [ -n "$pids" ]; then
    echo "MCP port $MCP_PORT remains occupied after stopping the owned advisor process" >&2
    return 1
  fi
  nohup node src/server.mjs >>"$LOG_DIR/mcp.log" 2>&1 </dev/null &
  new_pid=$!
  printf '%s\n' "$new_pid" > "$SERVER_PID_FILE"
  ready=0
  for _ in $(seq 1 80); do
    if curl -fsS "http://127.0.0.1:$MCP_PORT/healthz" >/dev/null 2>&1; then ready=1; break; fi
    if ! kill -0 "$new_pid" 2>/dev/null; then break; fi
    sleep 0.1
  done
  if [ "$ready" -ne 1 ]; then
    echo 'MCP-only reload failed healthz; stopping the new MCP process; tunnel process was not touched' >&2
    stop_pid "$new_pid" mcp || true
    rm -f "$SERVER_PID_FILE"
    return 1
  fi
  if ! kill -0 "$old_tunnel" 2>/dev/null || ! is_our_tunnel "$old_tunnel"; then
    echo "MCP reloaded, but the existing tunnel PID $old_tunnel is no longer verified" >&2
    return 1
  fi
  echo "MCP_RELOADED: MCP PID $new_pid; existing tunnel PID $old_tunnel unchanged"
}

cmd="${1:-}"
if { [ "$cmd" = down ] || [ "$cmd" = reload-mcp ]; } && [ -s "$CLIENT_FILE" ]; then
  saved_client=$(<"$CLIENT_FILE")
  [ -x "$saved_client" ] && TUNNEL_CLIENT="$saved_client"
fi
case "$cmd" in
  reload-mcp)
    reload_mcp
    ;;
  up)
    node ../../src/lifecycle-key.mjs "$AGENT_MCP_CONFIG"
    need_credentials
    if ! python3 - "$MCP_ROOTS_JSON" "$MCP_ENABLED_OPERATIONS" <<'PY'
import json, os, re, sys
try:
    roots=json.loads(sys.argv[1])
    assert isinstance(roots, dict)
    gateway_ops = {'gateway_status', 'opencode_start', 'opencode_continue', 'opencode_status', 'opencode_diff', 'opencode_abort'}
    assert roots or set(sys.argv[2].split(',')).issubset(gateway_ops)
    for name, path in roots.items():
        assert re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,31}', name)
        assert isinstance(path, str) and os.path.isabs(path) and os.path.isdir(path)
except Exception:
    print('MCP_ROOTS_JSON must map valid root names to existing absolute directories', file=sys.stderr)
    sys.exit(1)
PY
    then exit 2; fi
    old_mcp=$(read_pid "$SERVER_PID_FILE")
    old_tunnel=$(read_pid "$TUNNEL_PID_FILE")
    if [ -n "$old_mcp" ] && kill -0 "$old_mcp" 2>/dev/null && is_our_mcp "$old_mcp" \
      && [ -n "$old_tunnel" ] && kill -0 "$old_tunnel" 2>/dev/null && is_our_tunnel "$old_tunnel"; then
      echo "Already up (MCP PID $old_mcp, tunnel PID $old_tunnel)"
      exit 0
    fi
    if pids=$(listener_pids "$MCP_PORT"); [ -n "$pids" ]; then
      echo "MCP port $MCP_PORT is occupied; run '$0 down' first, or inspect the owner" >&2
      exit 1
    fi
    if pids=$(listener_pids "$HEALTH_PORT"); [ -n "$pids" ]; then
      echo "Tunnel health port $HEALTH_PORT is occupied; run '$0 down' first, or inspect the owner" >&2
      exit 1
    fi
    nohup node src/server.mjs >>"$LOG_DIR/mcp.log" 2>&1 </dev/null &
    server_pid=$!
    printf '%s\n' "$server_pid" > "$SERVER_PID_FILE"
    ready=0
    for _ in $(seq 1 80); do
      if curl -fsS "http://127.0.0.1:${MCP_PORT}/healthz" >/dev/null 2>&1; then ready=1; break; fi
      if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
      sleep 0.1
    done
    if [ "$ready" -ne 1 ]; then
      echo 'MCP server failed to become ready; see mcp.log' >&2
      stop_pid "$server_pid" mcp || true
      rm -f "$SERVER_PID_FILE"
      exit 1
    fi
    printf '%s\n' "$TUNNEL_CLIENT" > "$CLIENT_FILE"
    nohup "$TUNNEL_CLIENT" run \
      --control-plane.tunnel-id "$CONTROL_PLANE_TUNNEL_ID" \
      --control-plane.api-key "$api_key_ref" \
      --mcp.server-url "url=http://127.0.0.1:${MCP_PORT}/mcp" \
      --health.listen-addr "$HEALTH_ADDR" >>"$LOG_DIR/tunnel.log" 2>&1 </dev/null &
    tunnel_pid=$!
    printf '%s\n' "$tunnel_pid" > "$TUNNEL_PID_FILE"
    tunnel_ready=0
    for _ in $(seq 1 150); do
      if curl -fsS "http://${HEALTH_ADDR}/readyz" >/dev/null 2>&1; then tunnel_ready=1; break; fi
      if ! kill -0 "$tunnel_pid" 2>/dev/null; then break; fi
      sleep 0.2
    done
    if [ "$tunnel_ready" -ne 1 ]; then
      echo 'Tunnel failed readiness check; stopping both processes. See tunnel.log' >&2
      stop_pid "$tunnel_pid" tunnel || true
      stop_pid "$server_pid" mcp || true
      rm -f "$TUNNEL_PID_FILE" "$SERVER_PID_FILE"
      exit 1
    fi
    echo "UP: MCP http://127.0.0.1:${MCP_PORT}/mcp; tunnel ready at http://${HEALTH_ADDR}/readyz"
    echo "Whitelist roots: $MCP_ROOTS_JSON"
    echo "Enabled operations: $MCP_ENABLED_OPERATIONS"
    ;;
  down)
    errors=0
    tunnel_pid=$(read_pid "$TUNNEL_PID_FILE")
    server_pid=$(read_pid "$SERVER_PID_FILE")
    [ -z "$tunnel_pid" ] || { stop_pid "$tunnel_pid" tunnel || errors=1; }
    [ -z "$server_pid" ] || { stop_pid "$server_pid" mcp || errors=1; }
    # Also clean up this project's earlier foreground-start instances (without PID files).
    for pid in $(listener_pids "$HEALTH_PORT"); do
      if is_our_tunnel "$pid"; then stop_pid "$pid" tunnel || errors=1; fi
    done
    for pid in $(listener_pids "$MCP_PORT"); do
      if is_our_mcp "$pid"; then stop_pid "$pid" mcp || errors=1; fi
    done
    if [ "$errors" -ne 0 ]; then
      echo 'One or more owned processes did not stop; refusing to claim ports are free.' >&2
      exit 1
    fi
    rm -f "$SERVER_PID_FILE" "$TUNNEL_PID_FILE" "$CLIENT_FILE"
    sleep 0.2
    for port in "$MCP_PORT" "$HEALTH_PORT"; do
      if [ -n "$(listener_pids "$port")" ]; then echo "Port $port remains occupied" >&2; exit 1; fi
    done
    echo "DOWN: MCP port $MCP_PORT and tunnel health port $HEALTH_PORT are free"
    ;;
  *)
    echo "Usage: $0 {up|down|reload-mcp}" >&2
    exit 2
    ;;
esac
