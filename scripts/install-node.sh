#!/usr/bin/env bash
# Install a verified official Node.js binary into the current user's MCP directory if needed.
set -euo pipefail
ROOT="${PERSONAL_MCP_ROOT:-$HOME/.local/share/opencode-mcp}"
NODE_VERSION="${NODE_BOOTSTRAP_VERSION:-22.19.0}"
target="$ROOT/opt/node-v${NODE_VERSION}"
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>22||(major===22&&minor>=19)?0:1)' >/dev/null 2>&1; then
  echo "Node.js: $(node --version)（复用现有安装）"
  exit 0
fi
if [[ -x "$target/bin/node" ]]; then
  echo "Node.js: $target（复用已安装版本）"
  exit 0
fi
case "$(uname -s)" in Linux) os=linux ;; *) echo "仅支持 Linux" >&2; exit 2 ;; esac
case "$(uname -m)" in x86_64|amd64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) echo "不支持的 CPU 架构" >&2; exit 2 ;; esac
for cmd in curl sha256sum tar xz; do command -v "$cmd" >/dev/null || { echo "缺少系统命令: $cmd" >&2; exit 2; }; done
mkdir -p "$ROOT/opt"
tmp="$(mktemp -d "$ROOT/opt/.node-download.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
stem="node-v${NODE_VERSION}-${os}-${arch}"
archive="$stem.tar.xz"
base="https://nodejs.org/dist/v${NODE_VERSION}"
echo "下载 Node.js ${NODE_VERSION} (${os}/${arch}) ..."
curl -fsSL --retry 2 --connect-timeout 15 "$base/SHA256SUMS.txt" -o "$tmp/SHA256SUMS.txt"
curl -fsSL --retry 2 --connect-timeout 15 "$base/$archive" -o "$tmp/$archive"
expected="$(awk -v name="$archive" '$2==name {print $1}' "$tmp/SHA256SUMS.txt")"
[[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || { echo "Node 官方校验和缺失" >&2; exit 1; }
printf '%s  %s\n' "$expected" "$tmp/$archive" | sha256sum -c - >/dev/null
tar -xJf "$tmp/$archive" -C "$tmp"
[[ -x "$tmp/$stem/bin/node" ]] || { echo "Node 安装包不完整" >&2; exit 1; }
mv "$tmp/$stem" "$target"
echo "Node.js 已安装：$target/bin/node"
