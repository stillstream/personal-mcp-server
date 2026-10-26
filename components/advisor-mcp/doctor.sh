#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
fail=0
printf 'agent-mcp-advisor doctor\n'
if command -v node >/dev/null && node -e 'const [major,minor]=process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)'; then
  printf '%s\n' 'PASS: Node.js >= 22.19'
else
  printf '%s\n' 'FAIL: Node.js >= 22.19 is required'; fail=1
fi
if [ -f "$PWD/../../node_modules/@modelcontextprotocol/sdk/package.json" ]; then
  printf '%s\n' 'PASS: monorepo MCP SDK installed'
else
  printf '%s\n' 'FAIL: run npm ci from the agent-mcp root'; fail=1
fi
config="$(printenv AGENT_MCP_CONFIG || true)"
if [ -z "$config" ]; then config="$HOME/.config/agent-mcp/instance.json"; fi
if [ -r "$config" ] && node src/config-cli.mjs "$config" >/dev/null 2>&1; then
  printf '%s\n' 'PASS: private instance config and advisor allowlist validate'
  mapfile -d '' -t values < <(node src/config-cli.mjs "$config")
  if [ "${#values[@]}" -eq 13 ] && [ -x "${values[4]}" ] && [ -r "${values[6]}" ]; then
    printf '%s\n' 'PASS: pinned Tunnel runtime and API-key file reference configured (values not shown)'
  else
    printf '%s\n' 'FAIL: Tunnel runtime or key-file reference unavailable'; fail=1
  fi
else
  printf '%s\n' 'FAIL: private instance config missing or invalid'; fail=1
fi
npm test || fail=1
exit "$fail"
