#!/usr/bin/env bash
set -euo pipefail
VERSION="${OPENCODE_VERSION:-2.1.2}"
MODE="${1:-check}"
BIN="${OPENCODE_BIN:-$(command -v opencode || true)}"
case "$MODE" in
  check)
    echo "Pinned OpenCode version: $VERSION"
    echo "Detected binary: ${BIN:-not found}"
    if [[ -n "$BIN" ]]; then "$BIN" --version; fi
    echo 'Install is intentionally not automatic; run with install after reviewing the official installer.'
    ;;
  install)
    [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo "Linux x86_64 required" >&2; exit 1; }
    command -v curl >/dev/null
    echo "Installing pinned OpenCode $VERSION using official installer"
    curl -fsSL https://opencode.ai/install | bash -s -- --version "$VERSION"
    NEW_BIN="${OPENCODE_BIN:-$(command -v opencode || true)}"
    [[ -n "$NEW_BIN" ]] || { echo "Installed binary not on PATH; set OPENCODE_BIN" >&2; exit 1; }
    [[ "$("$NEW_BIN" --version)" == "$VERSION" ]] || { echo "VERSION_MISMATCH" >&2; exit 1; }
    ;;
  *) echo 'Usage: scripts/opencode-install.sh check|install' >&2; exit 2 ;;
esac
