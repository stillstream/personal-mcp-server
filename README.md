# Personal MCP Server

基于 **RDK S100-1 当前运行的 MCP 执行服务**整理的个人私有项目（初始基线：2026-10-21），用于让 ChatGPT 等 MCP Client 远程执行设备上的命令，并按需协同 OpenCode。

本仓库是可维护的源码基线，**不会自动更新或修改 S100 上正在运行的服务**。

## 一、当前能力与架构

```text
ChatGPT / 其他 MCP Client
          │
          ▼
  ChatGPT Tunnel / 局域网
          │
          ▼
      MCP Server
          │
          ├── s100_exec  执行 Shell 命令
          ├── s100_poll  查询异步任务
          └── s100_stop  终止任务
          │
          ▼
  本机 Shell / OpenCode
```

- **已实现**：通过带 Bearer Token 认证的 Streamable HTTP 提供 `s100_exec`、`s100_poll`、`s100_stop` 三个工具。
- **执行权限**：继承 MCP 服务进程所属的 Linux 用户权限。S100 当前以 `sunrise` 用户运行，**并非默认拥有 root 权限**；目前不设置项目目录白名单。
- **ChatGPT 隧道入口**：本机 `127.0.0.1:18878/mcp`。
- **局域网入口（可选）**：`0.0.0.0:18879/mcp`，同样需要认证。
- **OpenCode HTTP 服务（可选）**：`127.0.0.1:4096`。OpenCode 在本机开发时优先使用原生 Shell、文件工具，**无需反向连接自己的 MCP Server**。
- **规划中，尚未实现**：供宿主机或容器使用的 Restricted（受限）部署模式。当前服务不提供沙箱隔离，不能把它当作低权限沙箱使用。

## 二、仓库结构

| 路径 | 用途 |
| --- | --- |
| `src/server.mjs` | MCP HTTP Server，负责命令执行和异步任务生命周期管理 |
| `src/stdio-client.mjs` | stdio 到 HTTP 的兼容桥接 |
| `bin/` | S100 OpenCode、Tunnel 启动脚本 |
| `systemd/` | S100 用户级 systemd 服务定义，供部署参考 |
| `test/acceptance.mjs` | 非侵入式 MCP 工具发现测试，需要本机 MCP 服务和认证 Token |
| `package.json`、`package-lock.json` | Node.js 依赖及版本锁定 |

## 三、S100 部署说明

本版本保留 S100 现有部署布局。

**依赖**：Node.js ≥ 22.19、npm；如需协同 OpenCode，须单独安装 OpenCode CLI/Server 2.0.32；如需连接 ChatGPT，须单独部署 Tunnel Client。本仓库**不包含** OpenCode 二进制或第三方 Tunnel 二进制。

1. 将代码放到目标设备的 `~/.local/share/opencode-mcp/`，执行 `npm ci`。已有运行中的部署不要直接覆盖。
2. 在 `runtime/` 下准备以下本地凭据，并设置文件权限为 `0600`：
   - `access-token`：MCP Bearer Token；MCP Server 首次启动时也可以自动生成。
   - `opencode-password`：OpenCode HTTP 服务认证密码。
   - `control-plane-api-key`：ChatGPT Tunnel 控制平面密钥。
3. 将 `systemd/` 中所需服务文件复制到 `~/.config/systemd/user/`，根据目标账号调整绝对路径、端口等参数。Tunnel ID 通过本机 systemd 覆盖配置（`systemctl --user edit s100-opencode-chatgpt-tunnel.service`）传入环境变量 `CHATGPT_TUNNEL_ID`，不要写入 Git。
4. 仅启用实际需要的服务。检查 `http://127.0.0.1:18878/healthz`，并使用有效 Token 访问 MCP 端点。
5. 执行 `npm test` 可进行 MCP 认证及工具发现的基础测试，**不会执行 Shell 任务**。

> 当前 S100 的 Tunnel Client 和 MCP Server 运行在**同一台设备**上，但它们是独立服务。复制仓库不会自动创建或迁移 ChatGPT Tunnel ID；不同设备需要各自配置隧道注册信息。

## 四、安全与维护原则

- **Trusted（可信执行）现状**：S100 服务使用 `sunrise` 账号的实际系统权限，未增加项目目录白名单。
- **Restricted（受限执行）规划**：后续可在同一套源码中增加宿主机/容器的受限部署配置，但必须依靠操作系统权限、容器隔离等机制真正约束权限，不能只依赖 Agent 提示词。
- Bearer Token 等同于远程命令执行授权凭据。**GitHub 私有仓库不是密钥仓库**；密钥和密码应保留在本机 `runtime/` 中，不能提交。
- 局域网服务监听所有网卡地址，应通过可信 LAN/VPN、网络访问控制限制来源；**不要把 18879 端口直接映射到公网**。
- 当前不配置从 GitHub 到 S100 的自动部署。后续修改先提交仓库，再由用户明确选择是否更新运行环境。
- 优先保持 `exec / poll / stop` 接口简洁稳定；后续增量实现 Trusted / Restricted 模式，避免为同一台机器重复增加不必要的 MCP 调用层。

## 五、项目定位

这个仓库负责维护**跨设备远程执行的 MCP 服务端**。与之相对，OpenCode 在本机工作时应优先使用自身原生工具；只有需要访问其他系统的专用能力时，才额外配置 MCP Client。

目标是形成：**一套 MCP Server 源码、两类部署模式、每台设备独立配置**。目前仓库仅包含已落地的 S100 基线，受限模式仍属后续计划。
