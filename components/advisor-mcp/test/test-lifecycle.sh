#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$(dirname -- "$0")")"
tmp=$(mktemp -d)
config="$tmp/instance.json"
generated_key=""
cleanup() {
  AGENT_MCP_CONFIG="$config" MCP_TUNNEL_STATE_DIR="$tmp/state" TUNNEL_CLIENT="$PWD/test/fake-tunnel-client.py" ./start-openai-tunnel.sh down >/dev/null 2>&1 || true
  if [ -n "$generated_key" ]; then
    case "$generated_key" in "$PWD/../../.local/credentials/"tunnel-*.key) rm -f -- "$generated_key" ;; esac
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT
mkdir -p "$tmp/root-a" "$tmp/root-b"
read -r advisor_port health_port < <(python3 -c 'import socket; a=socket.socket(); b=socket.socket(); a.bind(("127.0.0.1",0)); b.bind(("127.0.0.1",0)); print(a.getsockname()[1],b.getsockname()[1])')
printf '%s' 'smoke-token-abcdefghijklmnopqrstuvwxyz0123456789' > "$tmp/chatgpt.token"
chmod 600 "$tmp/chatgpt.token"
python3 - "$config" "$tmp/root-a" "$tmp/root-b" "$tmp/chatgpt.token" "$PWD/test/fake-tunnel-client.py" "$advisor_port" "$health_port" <<'PY'
import json, os, sys
config, root_a, root_b, token_file, tunnel_binary, advisor_port, health_port = sys.argv[1:]
obj = {
    'machine_id': 'advisor-lifecycle-test',
    'listen': {'host': '127.0.0.1', 'port': 18879},
    'existing_tunnel': {'id': 'test-tunnel', 'api_key_file': token_file, 'old_target': f'http://127.0.0.1:{advisor_port}/mcp'},
    'callers': [{'id': 'chatgpt', 'level': 'L2', 'token_file': token_file}],
    'host_read_roots': {},
    'host_write_roots': {},
    'containers': [],
    'advisor_mcp': {
        'enabled': True,
        'listen': {'host': '127.0.0.1', 'port': int(advisor_port), 'path': '/mcp'},
        'gateway_caller': 'chatgpt',
        'roots': {'alpha': root_a, 'beta': root_b},
        'write_roots': ['alpha', 'beta'],
        'file_operations': ['list_files', 'read_file', 'write_file', 'create_directory', 'file_info', 'search_files', 'search_text', 'git_summary', 'delete_file', 'delete_directory', 'rename_file'],
        'gateway_tools': ['gateway_status', 'opencode_start', 'opencode_continue', 'opencode_status', 'opencode_diff', 'opencode_abort'],
    },
    'tunnel_client': {'enabled': True, 'binary': tunnel_binary, 'health_addr': f'127.0.0.1:{health_port}', 'target_url': f'http://127.0.0.1:{advisor_port}/mcp'},
}
if os.environ.get('LIFECYCLE_INLINE_SECRETS') == '1':
    obj['callers'][0].pop('token_file')
    obj['callers'][0]['token'] = 'smoke-token-abcdefghijklmnopqrstuvwxyz0123456789'
    obj['existing_tunnel'].pop('api_key_file')
    obj['existing_tunnel']['api_key'] = 'FAKE_TEST_TUNNEL_KEY_ONLY'
    os.unlink(token_file)
with open(config, 'w', encoding='utf-8') as f:
    json.dump(obj, f)
    f.write('\n')
os.chmod(config, 0o600)
PY
export AGENT_MCP_CONFIG="$config"
export MCP_TUNNEL_STATE_DIR="$tmp/state"
export TUNNEL_CLIENT="$PWD/test/fake-tunnel-client.py"
export CONTROL_PLANE_TUNNEL_ID=test-tunnel
export CONTROL_PLANE_API_KEY_FILE="$tmp/chatgpt.token"
if [ "${LIFECYCLE_INLINE_SECRETS:-0}" = 1 ]; then
  generated_key="$PWD/../../.local/credentials/tunnel-$(printf %s "$config" | sha256sum | cut -d' ' -f1).key"
fi
./start-openai-tunnel.sh up
curl -fsS "http://127.0.0.1:$advisor_port/healthz" | grep -q '"alpha"'
curl -fsS "http://127.0.0.1:$health_port/readyz" | grep -q ready
tunnel_pid_before=$(tr -dc '0-9' < "$tmp/state/tunnel.pid")
./start-openai-tunnel.sh reload-mcp
tunnel_pid_after=$(tr -dc '0-9' < "$tmp/state/tunnel.pid")
[ "$tunnel_pid_before" = "$tunnel_pid_after" ] || { echo 'MCP-only reload changed Tunnel PID' >&2; exit 1; }
curl -fsS "http://127.0.0.1:$advisor_port/healthz" | grep -q '"opencode_start"'
curl -fsS "http://127.0.0.1:$health_port/readyz" | grep -q ready
./start-openai-tunnel.sh down
if ss -ltn "( sport = :$advisor_port or sport = :$health_port )" | grep -q LISTEN; then
  echo 'lifecycle test failed: test port still listening' >&2
  exit 1
fi
echo 'lifecycle ok: central instance config drives multi-root advisor and tunnel reload preserves the Tunnel PID'
