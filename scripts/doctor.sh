#!/usr/bin/env bash
# Read-only diagnostics. No secrets are printed.
set -euo pipefail
source "$HOME/.local/share/opencode-mcp/bin/common.sh"
echo "执行用户：$(id -un)"
echo "系统架构：$(uname -m)"
echo "部署目录：$MCP_ROOT"
echo "配置文件：$DEPLOY_CONFIG"
if command -v node >/dev/null; then echo "Node.js：$(node --version)"; else echo "Node.js：未安装"; fi
if [[ -n "$OPENCODE_CLI_BIN" && -x "$OPENCODE_CLI_BIN" ]]; then
  echo "OpenCode CLI：$("$OPENCODE_CLI_BIN" --version)"
else
  echo "OpenCode CLI：未安装"
fi
[[ ! -x "$TUNNEL_CLIENT_BIN" ]] || echo "Tunnel Client：$TUNNEL_CLIENT_BIN"
echo "MCP Token：$([[ -s "$MCP_TOKEN_FILE" ]] && echo 已配置 || echo 缺失)"
echo "隧道 ID：$([[ -n "$CHATGPT_TUNNEL_ID" ]] && echo 已配置 || echo 未配置)"
echo "隧道 API Key：$([[ -s "$CONTROL_PLANE_KEY_FILE" ]] && echo 已配置 || echo 缺失)"
for unit in personal-mcp personal-mcp-lan personal-opencode personal-tunnel; do
  if systemctl --user is-active --quiet "$unit.service" 2>/dev/null; then
    echo "systemd $unit：运行中"
  else
    echo "systemd $unit：未运行"
  fi
done
if command -v curl >/dev/null; then
  echo "MCP 健康检查：$(curl -fsS --max-time 2 "http://127.0.0.1:$MCP_PORT/healthz" 2>/dev/null || echo 不可达)"
  if [[ -n "$CHATGPT_TUNNEL_ID" ]]; then
    echo "隧道就绪 HTTP：$(curl -sS -o /dev/null --max-time 2 -w '%{http_code}' "http://127.0.0.1:$TUNNEL_HEALTH_PORT/readyz" 2>/dev/null || true)"
  fi
fi
