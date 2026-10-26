#!/usr/bin/env bash
# Manages the canonical local Gateway. Legacy unit is recognized only for cutover/rollback.
set -euo pipefail
unit=agent-mcp.service
marker='Agent MCP Gateway local runtime'
legacy_unit=agent-mcp-shadow.service
legacy_marker='Agent MCP Gateway owned shadow runtime'
if [ "$#" -lt 1 ]; then echo 'usage: service.sh start <release-dir> <instance.json> | stop | stop-legacy | status | logs' >&2; exit 2; fi
cmd="$1"
case "$cmd" in
 start)
  if [ "$#" -lt 2 ]; then echo 'usage: service.sh start <absolute-release-dir> <absolute-instance.json>' >&2; exit 2; fi
  release="$2"; instance="${3:-${AGENT_MCP_CONFIG:-$(cd -- "$(dirname -- "$0")/.." && pwd -P)/config/instance.local.json}}"
  [[ "$release" = /* && "$instance" = /* && -f "$release/src/server.mjs" && -f "$instance" && ! -L "$instance" ]] || { echo 'invalid release/config paths' >&2; exit 2; }
  legacy_state="$(systemctl --user show "$legacy_unit" -p ActiveState --value 2>/dev/null || true)"
  [[ "$legacy_state" != active && "$legacy_state" != activating ]] || { echo 'legacy Gateway still active; stop it first to avoid parallel service' >&2; exit 2; }
  state="$(systemctl --user show "$unit" -p LoadState --value 2>/dev/null || true)"
  [[ "$state" = not-found || -z "$state" ]] || { echo 'canonical Gateway unit already exists; inspect status before replacing' >&2; exit 2; }
  node="$(command -v node)"
  systemd-run --user --collect --service-type=exec --unit="$unit" --description="$marker" --setenv="AGENT_MCP_CONFIG=$instance" "$node" "$release/src/server.mjs"
  ;;
 stop)
  description="$(systemctl --user show "$unit" -p Description --value 2>/dev/null || true)"
  [[ "$description" = "$marker" ]] || { echo 'not the owned canonical Gateway unit; refusing stop' >&2; exit 2; }
  systemctl --user stop "$unit"
  ;;
 stop-legacy)
  description="$(systemctl --user show "$legacy_unit" -p Description --value 2>/dev/null || true)"
  [[ "$description" = "$legacy_marker" ]] || { echo 'legacy unit ownership marker mismatch; refusing stop' >&2; exit 2; }
  systemctl --user stop "$legacy_unit"
  ;;
 status)
  systemctl --user status "$unit" --no-pager
  ;;
 logs)
  journalctl --user-unit="$unit" -n 60 --no-pager
  ;;
 *)
  echo 'usage: service.sh start <absolute-release-dir> <absolute-instance.json> | stop | stop-legacy | status | logs' >&2
  exit 2
  ;;
esac
