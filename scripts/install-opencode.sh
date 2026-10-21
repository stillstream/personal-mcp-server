#!/usr/bin/env bash
# OpenCode v2 uses the official @opencode/cli package, not the OpenCode 1.x package.
set -euo pipefail
source "$HOME/.local/share/opencode-mcp/bin/common.sh"
valid_v2() {
  [[ -x "$1" ]] || return 1
  "$1" --version 2>/dev/null | grep -Eq '(^|[[:space:]]|v)2[.]'
}
if [[ -n "$OPENCODE_CLI_BIN" ]] && valid_v2 "$OPENCODE_CLI_BIN"; then
  echo "OpenCode CLI: $OPENCODE_CLI_BIN（复用已安装 v2）"
  exit 0
fi
if [[ -n "${OPENCODE_CLI_BIN:-}" && ! -x "$OPENCODE_CLI_BIN" ]]; then
  echo "OPENCODE_CLI_BIN 指定的文件不存在或不可执行: $OPENCODE_CLI_BIN" >&2
  exit 2
fi
command -v npm >/dev/null || { echo "缺少 npm，请先安装 Node.js" >&2; exit 2; }
target="$MCP_ROOT/opt/opencode"
mkdir -p "$target"
echo "安装 OpenCode v2 (@opencode/cli@$OPENCODE_VERSION) ..."
npm install --prefix "$target" --no-save --no-audit --no-fund "@opencode/cli@$OPENCODE_VERSION"
exe="$target/node_modules/.bin/opencode"
valid_v2 "$exe" || { echo "OpenCode v2 安装失败：$exe" >&2; exit 1; }
mkdir -p "$HOME/.local/bin"
if [[ ! -e "$HOME/.local/bin/opencode" && ! -L "$HOME/.local/bin/opencode" ]]; then
  ln -s "$exe" "$HOME/.local/bin/opencode"
fi
echo "OpenCode CLI 已就绪：$exe"
