#!/usr/bin/env bash
set -euo pipefail
# opencode compatibility wrapper translates legacy --dir and --variant.
exec "$HOME/.local/bin/opencode" run --server http://127.0.0.1:4096 "$@"
