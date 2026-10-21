#!/usr/bin/env bash
# Per-user, repeatable deployment for Ubuntu/Linux (x86_64 and aarch64).
set -euo pipefail
umask 077
usage() {
  cat <<'HELP'
用法: bash scripts/install.sh [--with-opencode] [--with-cli] [--with-tunnel] [--with-lan] [--all] [--no-start]
默认：安装并启动本机回环 MCP 服务（端口 18878）
  --with-cli       安装或复用 OpenCode 2.x CLI，不启动 OpenCode Server
  --with-opencode  安装或复用 OpenCode 2.x CLI，并启动 OpenCode Server
  --with-tunnel    下载官方 OpenAI Tunnel Client 并启用隧道（须先配置 Tunnel ID/API Key）
  --with-lan       启用局域网 MCP（默认绑定 0.0.0.0:18879，谨慎使用）
  --all            MCP + OpenCode CLI/Server + Tunnel（不自动开放 LAN）
  --no-start       仅安装文件和依赖，不创建/启动 systemd 服务（适合预配置和测试）
HELP
}
cli=0
server=0
tunnel=0
lan=0
start=1
for arg in "$@"; do
  case "$arg" in
    --with-cli) cli=1 ;;
    --with-opencode) cli=1;server=1 ;;
    --with-tunnel) tunnel=1 ;;
    --with-lan) lan=1 ;;
    --all) cli=1;server=1;tunnel=1 ;;
    --no-start) start=0 ;;
    --help|-h) usage;exit 0 ;;
    *) echo "不支持的参数：$arg" >&2;usage >&2;exit 2 ;;
  esac
done
[[ "$(uname -s)" == Linux ]] || { echo "目前仅支持 Linux 主机" >&2; exit 2; }
command -v python3 >/dev/null || { echo "需要 python3" >&2; exit 2; }
command -v git >/dev/null || echo "提示：Git 不是运行依赖；首次拉取私有仓库仍需要 Git"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ROOT="$HOME/.local/share/opencode-mcp"
CONF_DIR="$HOME/.config/personal-mcp-server"
CONF="$CONF_DIR/deploy.env"
# Do not silently replace the user's existing S100/other independently managed service.
if [[ "$SRC" != "$ROOT" && -e "$ROOT/src/server.mjs" && ! -f "$ROOT/.personal-mcp-managed" ]]; then
  echo "已发现独立运行中的旧版 MCP：$ROOT" >&2
  echo "为避免覆盖 S100 生产服务，已拒绝安装。请在新设备部署，或另外制定迁移步骤。" >&2
  exit 2
fi
mkdir -p "$ROOT"/{src,bin,systemd,test,config,scripts,runtime,opt} "$CONF_DIR"
if [[ "$SRC" != "$ROOT" ]]; then
  cp "$SRC"/src/*.mjs "$ROOT/src/"
  cp "$SRC"/bin/*.sh "$SRC"/bin/*.py "$ROOT/bin/"
  cp "$SRC"/systemd/personal-*.service "$ROOT/systemd/"
  cp "$SRC"/config/deploy.env.example "$ROOT/config/"
  cp "$SRC"/test/acceptance.mjs "$ROOT/test/"
  cp "$SRC"/scripts/*.sh "$ROOT/scripts/"
  cp "$SRC"/package.json "$SRC"/package-lock.json "$ROOT/"
  cp "$SRC"/README.md "$ROOT/"
fi
touch "$ROOT/.personal-mcp-managed"
if [[ ! -e "$CONF" ]]; then
  cp "$SRC/config/deploy.env.example" "$CONF"
  chmod 600 "$CONF"
  echo "已生成本机配置：$CONF"
fi
chmod 700 "$ROOT/runtime" "$CONF_DIR"
# Bootstrap Node.js only if the currently available version is insufficient.
PERSONAL_MCP_ROOT="$ROOT" bash "$SRC/scripts/install-node.sh"
export PATH="$ROOT/opt/node-v22.19.0/bin:$HOME/.local/bin:$PATH"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(!(a>22||(a==22&&b>=19)))process.exit(1)'
npm ci --prefix "$ROOT" --no-audit --no-fund
# Files are generated locally, not checked into Git.
if [[ ! -s "$ROOT/runtime/access-token" ]]; then
  python3 -c 'import secrets; print(secrets.token_hex(32))' > "$ROOT/runtime/access-token"
fi
chmod 600 "$ROOT/runtime/access-token"
if [[ "$server" -eq 1 && ! -s "$ROOT/runtime/opencode-password" ]]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(36))' > "$ROOT/runtime/opencode-password"
fi
if [[ -f "$ROOT/runtime/opencode-password" ]]; then chmod 600 "$ROOT/runtime/opencode-password"; fi
if [[ "$cli" -eq 1 ]]; then
  bash "$SRC/scripts/install-opencode.sh"
fi
if [[ "$tunnel" -eq 1 ]]; then
  # The tunnel registration belongs to each target machine, not to the repository.
  source "$ROOT/bin/common.sh"
  if [[ -z "$CHATGPT_TUNNEL_ID" || ! -s "$CONTROL_PLANE_KEY_FILE" ]]; then
    echo "MCP 已安装，但隧道未启用：请填写 $CONF 中的 CHATGPT_TUNNEL_ID" >&2
    echo "并将相应控制平面的 API Key 放入 $CONTROL_PLANE_KEY_FILE (chmod 600)，然后重试 --with-tunnel。" >&2
    exit 2
  fi
  bash "$SRC/scripts/install-tunnel.sh"
fi
if [[ "$start" -eq 0 ]]; then
  echo "文件及依赖已安装（--no-start），未改动 systemd。"
  exit 0
fi
command -v systemctl >/dev/null || { echo "找不到 systemctl；可以使用 --no-start" >&2; exit 2; }
UNITS="$HOME/.config/systemd/user"
mkdir -p "$UNITS"
for unit in personal-mcp personal-mcp-lan personal-opencode personal-tunnel; do
  cp "$SRC/systemd/$unit.service" "$UNITS/"
done
systemctl --user daemon-reload
enable_unit() {
  local unit="$1"
  systemctl --user enable "$unit.service" >/dev/null
  if systemctl --user is-active --quiet "$unit.service"; then
    systemctl --user restart "$unit.service"
  else
    systemctl --user start "$unit.service"
  fi
}
enable_unit personal-mcp
if [[ "$lan" -eq 1 ]]; then enable_unit personal-mcp-lan; fi
if [[ "$server" -eq 1 ]]; then enable_unit personal-opencode; fi
if [[ "$tunnel" -eq 1 ]]; then enable_unit personal-tunnel; fi
source "$ROOT/bin/common.sh"
echo "部署完成：MCP=http://127.0.0.1:${MCP_PORT}/mcp"
echo "检查：bash $SRC/scripts/doctor.sh"
echo "重启后维持用户服务运行，可按需执行：sudo loginctl enable-linger $(id -un)"
