# Agent MCP 开发约定

## 项目职责

本分支是 Linux AMD64 Agent MCP Gateway。项目负责 MCP caller 权限、Host/Container 任务执行、OpenCode Server 生命周期和用户模型配置投影。

项目不负责模型服务部署或网络路由：不实现 HAProxy、Local/LAN/Tailscale 选择、网络健康检查或故障切换。Provider `baseURL` 完全由用户 OpenCode 配置指定，代码不得按模型名称改写端点、写死模型 ID 或推断端口。

## 唯一模型配置源

- 唯一来源为 `instance.opencode_config`，默认 `~/.config/opencode/opencode.jsonc`。
- Provider、model、small_model、variants、reasoning 参数和 API endpoint 不得复制到 `instance.models.host` 或 `instance.models.containers`；旧 `models` 配置必须明确拒绝。
- Host 和所有 Container 的 `modelConfig()` 必须读取同一用户配置。`prepareAll()` 应在一次操作中读取一次快照，再投影给所有目标。
- Host/Container 的运行配置、HOME/XDG、会话状态和服务认证仍然隔离。运行时投影不是第二份权威配置。
- 用户配置必须由当前用户持有、0600、非 symlink、单硬链接；它是 control-plane 文件，不能落入 Host/Container 可写目录或容器可写挂载。
- 配置变化由 `agent-mcp-model-sync.service` 监控；同步先校验并生成配置，再重启启用的 OpenCode 后端。失败必须显式报告，禁止静默回退到另一套模型配置。

## 安全边界

- Caller 身份和 L1/L2 权限只能来自 Gateway 私有实例配置，不能从工具参数或 Prompt 推断。
- Host 业务文件访问必须通过 Host Tools 与命名 root；不能给 Host OpenCode 直接挂载业务目录。
- Container 目标必须在白名单中，执行前复核 immutable Container ID、运行状态、privileged/PID namespace、docker.sock 和控制平面挂载。
- 用户 OpenCode 的 plugin、MCP 和 permission 配置不能覆盖 Gateway 自己的工具授权与执行隔离。
- Host Guard 的 Provider endpoint allowlist 是出站安全约束，不是网络路由器。受限 Host backend 只接受 guard 明确支持的 endpoint；不得为通过验收而放宽成任意外网访问。

## 代码与测试

- 配置读取、路径边界和模型投影必须有单元测试；JSONC 注释和 trailing comma 必须受支持。
- 自动同步必须覆盖普通写入、原子替换、无效配置、连续变更和服务重启；不能在配置校验失败时重启后端。
- Native 模型选择优先查询实际 OpenCode Model Catalog；默认模型应使用 OpenCode 的 resolved default，而不是维护第二份模型 allowlist。
- 对用户配置的 endpoint 只做必要的格式与安全校验；不改写 baseURL。
- 不在源码、测试、README 或模板中写入个人设备名、私有 IP、token、API key、具体 GPU 模型 ID 或用户目录。
- 回归入口：`npm test`、`npm run test:config`、`npm run test:advisor`、`npm run test:service`。实时模型推理测试必须由操作者显式执行，不能作为默认 CI 测试。

## 修改原则

优先复用现有 Gateway 生命周期与安全策略，避免增加第二套配置管理、模型路由器或并行服务。每个新能力必须说明唯一数据源、运行时投影、失败行为和回滚方式。
