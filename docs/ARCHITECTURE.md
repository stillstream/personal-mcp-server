# AMD64 Agent MCP Gateway 架构

## 职责边界

本仓库负责 MCP 身份与权限、任务编排、Host/Container OpenCode Server 生命周期，以及把用户 OpenCode 模型配置投影到隔离的运行环境。

本仓库不负责：

- 部署或管理模型推理服务；
- HAProxy、Local/LAN/Tailscale 网络选择、健康检查或故障切换；
- 修改用户 Provider 的 `baseURL` 或替用户选择网络地址。

Provider endpoint 由用户在 OpenCode 配置中指定，必须能从对应执行环境直接访问。

## 请求链

```text
MCP Client
    │
    ▼
Advisor MCP（可选）
    │
    ▼
Agent MCP Gateway
    ├── Host OpenCode Server
    └── 已登记 Docker Container 的 OpenCode Server
             │
             └── 用户 OpenCode 配置中的 Provider endpoint
```

## 唯一模型配置源

Gateway 私有实例配置默认位于 `~/.config/agent-mcp/instance.amd64.json`；用户模型配置默认位于 `~/.config/opencode/opencode.jsonc`，可通过私有实例配置的 `opencode_config` 指定其他路径。该文件是 Provider、默认模型、小模型、variants、reasoning 参数和 API endpoint 的唯一权威来源。

- Gateway 不再支持 `models.host` 或 `models.containers`。
- 源码只在固定 Git 工作区（`PROJECT_ROOT`）维护；运行配置和任务状态不得写入源码目录。
- 私有实例配置放在 `~/.config/agent-mcp/instance.amd64.json`；可变状态统一放在 `~/.local/state/agent-mcp/`。
- `modelConfig(instance, target, container)` 对 Host 和所有已登记 Container 返回同一份用户模型配置。
- `deploy/manage.mjs prepareAll()` 在一次准备过程中只读取一次配置快照，再将相同模型配置投影到各运行环境。
- Host 与 Container 仍有独立 HOME/XDG、配置目录、会话状态和服务凭据；投影文件不是第二个配置源。
- `agent-mcp-model-sync.service` 监控用户配置文件。文件原子替换或内容变化后，重新校验、生成两个运行配置并重启启用的 OpenCode 后端。无效配置不会应用。

用户配置文件须由当前服务用户持有，权限为 0600，且不得为符号链接或硬链接。Gateway 将其纳入 control-plane 保护路径，Host/Container 可写目录不得覆盖该文件或 `STATE_ROOT`。源码工作区是明确的开发目录，可由授权开发工具修改；它不承载运行状态。

## 安全边界

- Caller 的 L1/L2 权限由 Gateway 私有实例配置决定。
- Host 写操作由 Host root 白名单和 Host 运行时策略决定。
- Container 目标必须在私有容器名单中，执行前复核 immutable Container ID、运行状态和危险挂载。
- Host 与 Container 不继承用户 OpenCode 的插件、MCP、权限策略；Gateway 继续生成独立的执行权限配置。模型配置共享不意味着安全策略共享。
- Host 受限 Native 后端只允许其 guard 明确放行的 Provider endpoint；若 endpoint 不满足 Host guard 的限制，准备阶段或任务启动阶段会明确拒绝，不会偷偷改写 endpoint。

## 运维

- `node deploy/project-config.mjs check`：离线校验私有实例与用户 OpenCode 配置。
- `node deploy/manage.mjs prepare`：生成 Host/Container 隔离运行配置，不启动服务。
- `node deploy/manage.mjs sync-models`：从唯一用户配置重新投影并重启 OpenCode 后端。
- `./agent-mcp status|start|restart|stop|logs`：管理本项目服务。

完整部署与容器要求见 [README](../README.md)。
