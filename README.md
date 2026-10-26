# Personal MCP Server — AMD64 版本

本分支（`amd64`）提供面向 **Linux x86_64 / AMD64** 的个人 MCP Gateway：以同一服务入口管理宿主机及多个已存在 Docker 容器中的 OpenCode Server，并可通过 Advisor MCP 与 OpenAI Secure Tunnel 接入 ChatGPT。

**分支定位：** `main` 保存原嵌入式设备版本；`amd64` 保存本实现。两条分支独立维护，切换分支不会迁移机器上的服务或凭据。本 README 说明通用部署，不记录具体个人设备、账号、容器、模型或密钥。

## 1. 系统组成

```text
ChatGPT / MCP Client
    │（可选：OpenAI Secure Tunnel）
    ▼
Advisor MCP                  ← 文件/Git工具、Gateway代理工具
    │
    ▼
Agent MCP Gateway            ← Caller L1/L2、任务和权限路由
    ├── Host 原生 Shell + OpenCode Server
    └── Docker 容器 A / B / ... 原生 Shell + 各自 OpenCode Server
                     └── 用户配置的模型 API（vLLM / llama.cpp / 等）
```

| 组件 | 作用 | 默认监听 |
| --- | --- | --- |
| Gateway | MCP 任务、身份与目标路由 | `127.0.0.1:18879/mcp` |
| Advisor MCP | 向 ChatGPT 暴露文件、Git 和 Gateway 工具 | `127.0.0.1:8787/mcp` |
| OpenCode Host | 宿主机原生 OpenCode 2.1.2 后台实例 | `127.0.0.1:4100` |
| OpenCode Container | 每个已登记容器独立的 OpenCode 2.1.2 实例 | `4101` 起，逐个分配 |
| Secure Tunnel | 将 Advisor MCP 接入 ChatGPT；可选 | 健康检查端口示例 `38433` |

**模型推理服务不属于本仓库**：项目仅配置 OpenAI-compatible Provider 的地址、模型 ID 和认证信息，不负责部署模型或启动 GPU 推理容器。**Docker 容器也不由本项目创建**；仅对已有容器登记、启动/停止其 OpenCode 管理进程。

## 2. 运行环境与依赖

| 项目 | 需求 |
| --- | --- |
| 操作系统 | Linux x86_64 / AMD64；推荐 Ubuntu 22.04/24.04 |
| Node.js | **>= 22.19**，并在 `PATH` 中可执行 `node`、`npm` |
| OpenCode | **2.1.2**（宿主机必备；启用容器时容器内须可运行同版本二进制） |
| 常用工具 | `bash`、`python3`、`setsid`、`git`、`curl` |
| Docker（可选） | 安装 Docker CLI/daemon；服务用户能执行 `docker inspect/exec/cp` |
| 容器内依赖 | `python3`、`bash`、`setsid`、与 OpenCode 2.1.2 兼容的系统库 |
| 常驻服务 | `systemd --user`；允许用户服务运行 |
| 模型 | 至少一个从执行目标可达的兼容 API 地址；模型名称以服务端实际 ID 为准 |
| Tunnel（可选） | 已注册的 Tunnel ID、凭据，以及适用于 AMD64 的官方 Tunnel Client 运行时 |

当前版本主要在 Ubuntu x86_64 上验证；**不宣称 macOS、Windows 或 ARM64 兼容**。如模型 API 配置为 `127.0.0.1`，桥接网络容器不能直接使用宿主机回环地址；Host 网络容器通常可以。

## 3. 从 GitHub 部署

```bash
git clone -b amd64 git@github.com:stillstream/personal-mcp-server.git
cd personal-mcp-server

# 检查环境
node --version
npm --version
opencode --version                # 要求 OpenCode 2.1.2

# 安装项目 Node 依赖
npm ci

# 初始化当前设备的私有配置（首次执行）
node deploy/project-config.mjs init
```

私有实例路径：`config/instance.local.json`（仅本机存放，权限应为 0600，已加入 .gitignore）。模板见 `config/instance.example.json`。请根据当前设备逐项填写：

1. `machine_id`：当前机器唯一标识；`callers`：调用方、L1/L2 权限与 Token。
2. `runtime.host.enabled/binary/port/cwd`：是否启用宿主 OpenCode、**实际 2.1.2 二进制绝对路径**、唯一端口、绝对工作目录。
3. `models.host`：Provider 的 `baseURL`、`apiKey`、模型 ID、默认模型及小模型；端点必须从宿主机可达。
4. `advisor_mcp`：是否启用、文件根、向 ChatGPT 暴露的 `file_operations` 和 `gateway_tools`。
5. `tunnel_client` 与 `existing_tunnel`：只有启用 ChatGPT Tunnel 时才设置二进制路径、Tunnel ID 和私有 API Key。
6. 如需容器，先保持 `containers: []`、`models.containers: {}`，再按第 5 节登记。

`project-config.mjs init` **只创建配置草稿**，不会自动安装 OpenCode、创建 Docker 容器、注册 Tunnel 或启动服务；模板内的 `REPLACE_WITH_...` 值必须替换。

应用与检查：

```bash
./agent-mcp check        # 配置与后端检查
./agent-mcp start        # 按启用项生成 systemd 用户服务并启动
./agent-mcp status       # 查看 Gateway、OpenCode 后端及 PID
./agent-mcp logs 50      # 最近 50 行本项目服务日志
```

启动时按当前仓库路径生成 `deploy/systemd/` 下的本机用户服务定义，并通过 `systemctl --user` 管理。**不要把这些生成文件或实例私有配置提交到 Git。** 如需注销后常驻，可按设备策略启用 user lingering。

## 4. 可选：ChatGPT Tunnel

源码中包含 `components/tunnel-client/` 的组件说明和启动集成，但**不会将第三方运行时二进制、Tunnel ID 或 API Key 上传到仓库**。

从 [OpenAI Tunnel Client 官方发行版](https://github.com/openai/tunnel-client/releases) 获取适用于 AMD64 的运行时，按照官方清单核验 SHA-256，放置到本机目录（或在配置中指定绝对路径）；随后在私有配置中启用 `advisor_mcp`、`tunnel_client`，填写当前设备对应的 `existing_tunnel.id` 和 API Key 文件。配置 Advisor 代理工具范围后运行：

```bash
./agent-mcp check
./agent-mcp restart
./agent-mcp status
```

**多台设备同时在线时，每台设备分别使用自己的 Tunnel 身份。** Tunnel 只是 ChatGPT 与 Advisor 之间的网络入口；增加 OpenCode 容器不需要再创建 Tunnel。若更新 ChatGPT 可见的 MCP 工具，需在 ChatGPT 连接器侧刷新工具列表。

## 5. 新增已有 Docker 容器

前提：容器已启动；容器内有 `python3`、`bash`、`setsid`；架构和系统库能运行 OpenCode 2.1.2。宿主运行账号须有 Docker 操作权限。

```bash
# new-dev 是示例容器名称，需替换为实际名称
docker ps --filter name=new-dev
./agent-mcp add-container new-dev

# 可选：复用容器内已有且版本正确的二进制、指定端口
# ./agent-mcp add-container new-dev --binary /usr/local/bin/opencode --port 4102

# 如容器无法访问继承的模型 API，请编辑私有配置：
# models.containers.new-dev.provider.<provider>.options.baseURL

./agent-mcp restart
./agent-mcp status
```

`add-container` 会校验运行中容器身份、登记 Container ID、选择未占用端口、配置独立 OpenCode Profile，默认复用宿主机模型配置作为起点。管理通路使用 Docker 执行接口，不要求向外发布容器的 OpenCode 端口。**容器被删除重建后必须重新登记**，避免误用同名新容器。

## 6. 日常运维与权限

```bash
./agent-mcp status
./agent-mcp check
./agent-mcp restart      # 重新生成配置并重启已启用服务
./agent-mcp stop         # 不停止 Docker 容器与外部模型服务
./agent-mcp logs 100
./agent-mcp set runtime.host.port 4100    # 非敏感标量配置
```

权限模型：**L1** 维持配置的受限工具范围；**L2** 以宿主服务用户或容器用户身份执行原生操作，不额外添加路径沙箱。若宿主服务用户可控制 Docker，L2 可能间接获得很高的主机权限。请仅对可信调用方授予 L2，不要将 Advisor/Gateway 直接公开到互联网。

OpenCode 任务使用 `opencode_start/continue/status/diff/abort`；Shell 任务使用 `host_exec/poll/stop` 或 `container_exec/poll/stop`。模型配置在宿主与各容器独立生效，切换或更新运行配置不会自动启动外部模型服务。

## 7. 仓库与可迁移内容

```text
agent-mcp                      统一管理 CLI（使用 PATH 中的 node）
src/                           Gateway / 原生执行与会话路由
deploy/                        配置、生成服务、运行时管理
components/advisor-mcp/        Advisor MCP 与 Tunnel 启动逻辑
components/tunnel-client/      Tunnel 组件说明；不含运行时二进制
config/instance.example.json   无凭据配置模板
docs/                          架构与使用资料
tests/                         回归测试
package.json                   Node.js 版本和依赖
```

跨机器部署只迁移 Git 仓库中的代码；每台机器单独配置：Docker 容器名称/ID、OpenCode 二进制路径、模型 API、Caller Token、Tunnel 身份，以及运行账号和挂载。**Git 不携带 `.local/`、`node_modules/`、`config/instance.local.json`、生成的 systemd 服务或第三方 Tunnel 二进制。**

本分支是通用 AMD64 源码与部署接口，具体工作环境的历史记录不应被当作另一台机器的默认参数。
