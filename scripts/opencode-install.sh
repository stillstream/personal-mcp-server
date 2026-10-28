#!/usr/bin/env bash
set -euo pipefail
VERSION="2.1.2"
MODE="${1:-check}"
DEST="${OPENCODE_INSTALL_DIR:-$HOME/.local/bin}"
case "$MODE" in
check)
  if [[ -x "$DEST/opencode" ]]; then "$DEST/opencode" --version; else echo "not installed at $DEST/opencode"; fi
  echo "Pinned required version: $VERSION"
  ;;
install)
  [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || { echo "Linux x86_64 required" >&2; exit 1; }
  : "${OPENCODE_BINARY:?Set OPENCODE_BINARY to an approved OpenCode 2.1.2 binary}"
  : "${OPENCODE_SHA256:?Set OPENCODE_SHA256 to its independently verified SHA-256}"
  [[ -f "$OPENCODE_BINARY" && ! -L "$OPENCODE_BINARY" ]] || { echo "Invalid binary path" >&2; exit 1; }
  echo "$OPENCODE_SHA256  $OPENCODE_BINARY" | sha256sum --check --status || { echo "SHA256 mismatch" >&2; exit 1; }
  [[ "$("$OPENCODE_BINARY" --version)" == "$VERSION" ]] || { echo "Version mismatch" >&2; exit 1; }
  mkdir -p "$DEST"
  [[ ! -e "$DEST/opencode" ]] || { echo "Target exists: refusing overwrite" >&2; exit 1; }
  install -m 0755 "$OPENCODE_BINARY" "$DEST/opencode"
  "$DEST/opencode" --version
  ;;
*) echo 'Usage: opencode-install.sh check|install' >&2; exit 2 ;;
esac
