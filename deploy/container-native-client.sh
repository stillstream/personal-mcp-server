#!/bin/sh
# Native CLI entrypoints; no dependency on the retired /opt/container-mcp.
set -eu
client="${0##*/}"
case "$client" in
  opencode)
    export OPENCODE_CONFIG="${OPENCODE_CONFIG:-/root/.config/opencode/opencode.jsonc}"
    export OPENCODE_DISABLE_AUTOUPDATE="${OPENCODE_DISABLE_AUTOUPDATE:-1}"
    exec /usr/bin/opencode "$@"
    ;;
  codex) exec /usr/bin/codex "$@" ;;
  *) echo "unsupported native CLI entrypoint" >&2; exit 2 ;;
esac
