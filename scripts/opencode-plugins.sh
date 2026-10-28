#!/usr/bin/env bash
set -euo pipefail
MODE="${1:-status}"
CFG="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
case "$MODE" in
status)
  printf 'OpenCode configuration: %s\n' "$CFG"
  for f in "$CFG/opencode.json" "$CFG/opencode.jsonc" "$CFG/package.json"; do
    if [[ -f "$f" ]]; then echo "present: $f"; fi
  done
  ;;
install)
  [[ -f "$CFG/package.json" ]] || { echo 'Missing package.json' >&2; exit 2; }
  (cd "$CFG" && npm ci --ignore-scripts --no-audit --no-fund)
  echo 'Dependencies installed. Review plugin configuration before enabling.'
  ;;
*) echo 'Usage: opencode-plugins.sh status|install' >&2; exit 2 ;;
esac
