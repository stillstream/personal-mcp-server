#!/usr/bin/env bash
# Download the official OpenAI tunnel-client runtime archive and verify SHA256SUMS.
set -euo pipefail
source "$HOME/.local/share/opencode-mcp/bin/common.sh"
if [[ -x "$TUNNEL_CLIENT_BIN" ]]; then
  echo "Tunnel Client: $TUNNEL_CLIENT_BIN（复用已安装程序）"
  exit 0
fi
case "$(uname -s)" in Linux) os=linux ;; *) echo "目前自动安装只支持 Linux" >&2; exit 2 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "不支持的 CPU 架构" >&2; exit 2 ;; esac
for cmd in curl sha256sum python3; do command -v "$cmd" >/dev/null || { echo "缺少命令: $cmd" >&2; exit 2; }; done
version="$TUNNEL_VERSION"
[[ "$version" =~ ^v[0-9]+[.][0-9]+[.][0-9]+$ ]] || { echo "无效 TUNNEL_VERSION" >&2; exit 2; }
asset="tunnel-client-runtime-cloudflared-${version}-${os}-${arch}.zip"
url="https://github.com/openai/tunnel-client/releases/download/${version}"
target="$MCP_ROOT/bin/tunnel-client-${version}"
mkdir -p "$MCP_ROOT/bin"
tmp="$(mktemp -d "$MCP_ROOT/bin/.tunnel-download.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
echo "下载 OpenAI Tunnel Client ${version} (${os}/${arch}) ..."
curl -fsSL --retry 2 --connect-timeout 15 "$url/SHA256SUMS.txt" -o "$tmp/SHA256SUMS.txt"
curl -fsSL --retry 2 --connect-timeout 15 "$url/$asset" -o "$tmp/$asset"
expected="$(awk -v name="$asset" '$2==name || $2=="*"name {print $1}' "$tmp/SHA256SUMS.txt")"
[[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "官方 SHA256SUMS 未包含目标归档" >&2; exit 1; }
printf '%s  %s\n' "$expected" "$tmp/$asset" | sha256sum -c - >/dev/null
mkdir -p "$target"
# Extract only the expected release binaries, never arbitrary paths from a ZIP.
python3 - "$tmp/$asset" "$target" <<'PY'
import os
import pathlib
import shutil
import sys
import zipfile

archive = pathlib.Path(sys.argv[1])
target = pathlib.Path(sys.argv[2])
with zipfile.ZipFile(archive) as z:
    for name in ("tunnel-client-runtime-cloudflared", "cloudflared"):
        matches = [x for x in z.infolist() if pathlib.PurePosixPath(x.filename).name == name and not x.is_dir()]
        if len(matches) != 1:
            raise SystemExit(f"发行包缺少唯一的 {name} 可执行程序")
        destination = target / name
        with z.open(matches[0]) as src, destination.open("wb") as dst:
            shutil.copyfileobj(src, dst)
        os.chmod(destination, 0o755)
PY
echo "Tunnel Client 已安装：$target/tunnel-client-runtime-cloudflared"
