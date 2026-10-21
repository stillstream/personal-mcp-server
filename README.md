# Personal MCP Server

基于 RDK S100 已运行版本整理的**跨设备 MCP 远程执行服务**。同一仓库支持本机 Shell MCP、OpenCode v2 CLI/Server 和 OpenAI ChatGPT Tunnel Client；新设备通过安装脚本部署，不需要复制原设备的程序路径和二进制包。

> 当前实现是 **Trusted（可信执行）模式**：MCP 可以以服务账号权限执行任意 Shell 命令，不是只读接口，也没有项目路径白名单。**Restricted（受限执行）尚未实现**。仓库不会自动更新正在运行的 S100 旧服务。

## 1. 组成与能力

```text
ChatGPT / 其他 MCP Client
           │
           ├── ChatGPT Secure Tunnel（可选；每台设备独立注册）
           │
           └── LAN / VPN MCP（可选）
                    │
                    ▼
          Personal MCP Server
        exec / poll / stop（Bearer Token）
                    │
                    ├── 本机 Shell、文件与系统工具
                    └── OpenCode v2 CLI（可选）
                          └── OpenCode v2 HTTP Server（可选，本机 4096）
```

| 组件 | 实现 | 默认值 |
| --- | --- | --- |
| Shell MCP | `src/server.mjs`、`bin/run-mcp.sh` | `127.0.0.1:18878/mcp` |
| MCP LAN | 独立 systemd 用户服务（可选） | `0.0.0.0:18879/mcp` |
| OpenCode CLI | 复用本机 v2；缺失时安装官方 `@opencode/cli` | v2.0.32 |
| OpenCode Server | `bin/start-opencode-server.sh` | `127.0.0.1:4096` |
| Tunnel Client | 从 OpenAI 官方发行版按平台下载并校验 SHA-256 | v0.0.14 |
| systemd | `personal-*.service` 四个用户级服务 | 按需启用 |

MCP 工具名默认为 `s100_exec`、`s100_poll`、`s100_stop`，保留 S100 原插件接口；在新设备可以设置 `MCP_TOOL_PREFIX=lap1` 等，变为 `lap1_exec/poll/stop`。**修改前缀后必须重新发现/同步 MCP 工具**。

OpenCode 在同一主机上应优先使用自身原生的 Bash/文件工具，不必将本机 Shell MCP 再配置为 OpenCode 的外部工具。

## 2. 首次部署：新 Linux 设备

适用：Ubuntu/Linux `x86_64` 和 `aarch64`。需要 `bash`、`python3`、`curl`、`git`、`tar`、`sha256sum`、`xz` 和可用的网络；如需常驻，需要 systemd 用户服务。**不需要 sudo 安装 Node/OpenCode/Tunnel**：脚本优先复用系统现有 Node.js ≥22.19，不满足时下载并校验官方 Node.js 22.19.0；OpenCode v2 和 Tunnel 也安装到用户目录。

私有仓库必须先确保目标机器有 GitHub 克隆权限（SSH 密钥或 GitHub 认证）。

```bash
git clone git@github.com:stillstream/personal-mcp-server.git
cd personal-mcp-server

# 默认仅部署 Shell MCP
bash scripts/install.sh

# 常见个人开发机：Shell MCP + OpenCode v2 CLI/Server
bash scripts/install.sh --with-opencode

# 仅需要 OpenCode CLI，而不启动 HTTP Server
bash scripts/install.sh --with-cli
```

安装脚本可重复执行，第一次自动生成 MCP Token、本机配置和（启用 OpenCode Server 时）OpenCode 密码。**不会覆盖已有本机配置或模型 Provider 配置**。

| 路径 | 用途 |
| --- | --- |
| `~/.local/share/opencode-mcp/` | 实际运行的 MCP 源码、Node 依赖、CLI、Tunnel 程序 |
| `~/.local/share/opencode-mcp/runtime/` | MCP Token、OpenCode 密码、Tunnel API Key 等（不进入 Git） |
| `~/.config/personal-mcp-server/deploy.env` | 每台设备独立配置；安装时从模板生成 |
| `~/.config/systemd/user/personal-*.service` | systemd 用户服务 |
| `~/.config/opencode/` | OpenCode 自己的 Provider/模型配置，安装器不改动 |

### 完整部署：同时启用 Tunnel Client

Tunnel 连接需要**目标设备对应的 Tunnel ID 和控制平面 API Key**。这些值由 ChatGPT / OpenAI 的 Tunnel 注册流程取得，不能由本仓库自动生成。

先安装 MCP 与 OpenCode，编辑本机配置：

```bash
bash scripts/install.sh --with-opencode
nano ~/.config/personal-mcp-server/deploy.env
```

在配置里设置该设备的 `CHATGPT_TUNNEL_ID=tunnel_...`，需要时也可修改 `MCP_TOOL_PREFIX` 和端口。然后将对应的 API Key 安全写入：

`~/.local/share/opencode-mcp/runtime/control-plane-api-key`

并执行 `chmod 600` 设置该文件权限。**不要把真实密钥放进 README、命令行参数、Git 提交或聊天记录。**

完成注册信息后，执行：

```bash
# 一条命令完成 MCP + OpenCode CLI/Server + Tunnel 的安装及启动
bash scripts/install.sh --all

# 查看各服务状态和本机健康检查
bash scripts/doctor.sh
```

`--all` 默认**不开放 LAN**。若未配置 Tunnel ID / API Key，脚本会明确报错且不会启动 Tunnel；先填好凭据后重试。Tunnel 下载来源是 [openai/tunnel-client 官方发行版](https://github.com/openai/tunnel-client/releases)，通过 `SHA256SUMS.txt` 验证归档；不将约 50 MB 的发行包二进制放进私有 Git 仓库。

### 安装参数

| 参数 | 启用内容 |
| --- | --- |
| 不带参数 | MCP Server（127.0.0.1:18878） |
| `--with-cli` | MCP + OpenCode v2 CLI |
| `--with-opencode` | MCP + OpenCode v2 CLI + HTTP Server |
| `--with-tunnel` | MCP + Tunnel Client（需要预先配置注册信息） |
| `--with-lan` | MCP + LAN listener（需可信局域网） |
| `--all` | MCP + OpenCode CLI/Server + Tunnel |
| `--no-start` | 安装到用户目录，但**不创建或启动 systemd 服务** |

多个选项可以组合，例如 `--with-opencode --with-lan`。用户无需运行 OpenCode MCP 客户端回连本机 MCP。

## 3. 跨设备迁移配置（重点）

例如从 **S100** 迁移部署方案至 **aifly-lap1 / aifly-server1 / 新 ARM64 板卡**：

1. **新机器克隆仓库**：使用上述 `git clone`，不需要搬运 S100 的 `node_modules`、Tunnel 可执行文件、OpenCode 二进制或 systemd 固定路径。
2. **执行安装器**：新开发机一般用 `bash scripts/install.sh --with-opencode`；只需远程 Shell 则用不带参数的安装命令。
3. **编辑 `deploy.env`**：将 `MCP_TOOL_PREFIX` 改为 `lap1` / `server1` / `s100` 等；若端口被占用，修改 `MCP_PORT`、`MCP_LAN_PORT`、`OPENCODE_PORT`。
4. **配置 OpenCode 模型**：OpenCode 的 `~/.config/opencode/opencode.json` 或 `opencode.jsonc` 属于设备/用户配置，需要自行迁移或编辑 Provider、模型 URL、API Key。本仓库**不覆盖它们**。跨设备使用本地 Qwen 模型时，尤其要修改 Provider URL 的主机地址。
5. **配置 ChatGPT Tunnel**：每台设备注册独立的 Tunnel ID / API Key，写入对应本机配置与凭据文件，再运行 `bash scripts/install.sh --all`。旧设备继续在线时，**不要直接复制并并发复用同一个 Tunnel ID**；有意迁移原有 Tunnel ID 时，应先停掉旧设备上的隧道服务并迁移相应密钥。
6. **验证与开机常驻**：执行 `bash scripts/doctor.sh`；若用户退出登录后仍需服务持续运行，根据系统权限执行 `sudo loginctl enable-linger "$USER"`。

推荐的设备独立配置示例（只展示非机密内容）：

```bash
MCP_PORT=18878
MCP_LAN_PORT=18879
MCP_TOOL_PREFIX=lap1
OPENCODE_VERSION=2.0.32
OPENCODE_HOST=127.0.0.1
OPENCODE_PORT=4096
TUNNEL_VERSION=v0.0.14
CHATGPT_TUNNEL_ID=tunnel_请替换为本机ID
TUNNEL_HEALTH_PORT=38437
```

`TUNNEL_CLIENT_BIN` 和 `OPENCODE_CLI_BIN` 可填写已有程序的**绝对路径**，否则安装脚本优先复用已安装程序或在用户目录安装所需版本。Tunnel/Node 均从相应官方发行源获取，安装过程验证 SHA-256；OpenCode 使用官方 v2 npm 包。

**重要：现有 S100 原部署不会自动切换。** S100 原服务目前仍位于 `~/.local/share/opencode-mcp/` 并使用 `s100-opencode-*.service`；为避免覆盖，安装器检测到未经此仓库管理的同名运行目录时会拒绝安装。建议先在新设备验证。后续如需把 S100 原服务改为本仓库的可迁移服务，应单独执行一次受控切换。

## 4. 运维与验证

```bash
# 诊断（不会输出 Token / 密码）
bash scripts/doctor.sh

# 查看本机运行的 MCP
curl -fsS http://127.0.0.1:18878/healthz

# 查看用户服务
systemctl --user status personal-mcp.service
systemctl --user status personal-opencode.service
systemctl --user status personal-tunnel.service

# 工具发现验收，不执行 Shell 命令
cd ~/.local/share/opencode-mcp
npm test
```

`npm test` 应从已安装的 `~/.local/share/opencode-mcp/` 目录执行（该目录已安装 npm 依赖），需要运行中的 MCP、有效 Token，并且测试环境的 `MCP_TOOL_PREFIX` 与服务端一致。默认测试 `127.0.0.1:18878/mcp`；若自定义了端口与前缀，可显式设置 `MCP_PORT`、`MCP_TOOL_PREFIX`，或执行 `source bin/common.sh` 后使用对应环境变量。

### 在容器或没有 systemd 的环境使用

```bash
bash scripts/install.sh --no-start
# 随后运行：
bash ~/.local/share/opencode-mcp/bin/run-mcp.sh local
```

`--no-start` 不启用 systemd，适合容器。MCP 实际权限由容器/宿主机运行账号决定，**不会自动变成只读或路径白名单模式**。

### 后续更新

```bash
cd personal-mcp-server
git pull --ff-only
# 依照原本需要的组件重新运行安装命令，例如：
bash scripts/install.sh --with-opencode
```

更新仓库**不会**自动更改实际运行服务；重新运行安装脚本时才会复制新源码并重启它管理的服务。Tunnel ID、API Key、模型 Provider 配置均留在本机，不随仓库同步。

## 5. 安全边界与后续演进

- MCP Token 允许远程执行服务用户有权限执行的任意命令；任何可访问 LAN 18879 端口的终端，都必须经过 Bearer 认证，但**不要公开映射该端口**。
- 默认回环地址只允许本机/同机隧道访问；局域网访问需显式选择 `--with-lan`，并保证可信 LAN/VPN 和相应防火墙约束。
- `runtime/`、`.env`、密钥和 OpenCode 模型凭据不能进 Git；GitHub 私有仓库也不是密钥仓库。
- 未来规划统一 `Trusted` / `Restricted` 两种部署模式；当前只实现 Trusted，Restricted 应以 Linux 账号权限/容器隔离实施，不依赖 Agent 提示词。
- 维护原则：**一套 MCP Server 源码、不同设备各自配置、OpenCode 本地工具优先、Git 作为版本源**。

## 6. 仓库结构

```text
src/            MCP Server、stdio 兼容桥
bin/            Shell MCP、OpenCode Server、Tunnel 启动脚本
scripts/        一键安装、Node/OpenCode/Tunnel 安装与诊断
config/         设备配置样例（不含实际 Token）
systemd/        可移植的四个 systemd 用户服务
test/           MCP 非侵入式验收测试
package.json    Node 依赖
```

技术来源：[OpenAI Tunnel Client](https://github.com/openai/tunnel-client) · [OpenCode v2](https://opencode.ai/v2/v2/docs/build/)。
