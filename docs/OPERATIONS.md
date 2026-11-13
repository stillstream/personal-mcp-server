# AMD64 Gateway 运维

## 唯一模型配置源

- 默认用户配置：`~/.config/opencode/opencode.jsonc`。
- 私有实例配置中的 `opencode_config` 可以指定其他绝对路径或 `~/...` 路径。
- Provider、baseURL、API Key、默认模型、小模型、variants 和模型能力只在用户 OpenCode 配置中维护。
- `models.host` / `models.containers` 已移除；旧配置会明确报错，不会静默选择其中一套。
- 用户配置要求当前用户持有、0600、常规文件、单硬链接。Gateway 会将其作为 control-plane 文件保护，禁止 Host/Container 可写目录覆盖。

Host 与每个 Container 保留独立 HOME/XDG、OpenCode 服务、会话状态和运行时配置文件。模型配置投影由同一份用户配置生成；这些运行时文件不是新的权威配置。

## 配置同步

```bash
./agent-mcp check
./agent-mcp prepare
./agent-mcp start
./agent-mcp status
./agent-mcp sync-models
./agent-mcp logs 100
```

`agent-mcp-model-sync.service` 监控用户配置文件所在目录。检测到普通写入或原子替换后，会：

1. 重新读取并校验用户 OpenCode JSONC；
2. 在同一配置快照上生成 Host 和所有启用 Container 的隔离配置；
3. 重启对应 OpenCode 后端并等待 Ready；
4. 在 systemd journal 记录同步成功或失败。

无效配置不会被应用，也不会回退到旧的第二份模型配置。若同步失败，先修复用户 OpenCode 配置，再执行 `./agent-mcp sync-models`。

查看同步日志：

```bash
journalctl --user -u agent-mcp-model-sync.service -n 100 --no-pager
```

## Provider endpoint 与网络边界

本仓库只读取用户填写的 `baseURL`，不管理 HAProxy、Local/LAN/Tailscale 选择、网络健康检查或故障切换，也不会改写 Provider endpoint。

endpoint 必须从 Host 和相应 Container 直接可达。例如 `127.0.0.1` 在桥接网络 Container 内指向 Container 自身，而不是宿主机。应由用户提供适合各执行环境的可达地址；本项目不会代选网络地址。

受限 Native Host backend 还会按用户配置中的显式 loopback Provider endpoint 生成 egress 端口 allowlist。没有显式 endpoint 或不满足 Host guard 策略的模型会在启动/任务阶段明确拒绝。该 allowlist 是安全边界，不是网络路由器。

## Host / Container 安全边界

- Caller L1/L2、Host roots、Container 名称和身份由私有实例配置控制。
- Container 执行前复核 immutable Container ID、运行状态、privileged/PID namespace、docker.sock 与控制平面挂载。
- 用户 OpenCode 的插件、MCP、权限策略不会覆盖 Gateway 的工具授权和执行隔离。
- Host 与 Container 的模型配置相同，不意味着两者共享 HOME、会话、插件目录或权限。

## 回归测试

```bash
npm ci
npm test
npm run test:config
npm run test:advisor
npm run test:service
npm run test:advisor:lifecycle
```

配置和投影相关测试使用临时用户配置文件，不调用真实模型服务。真实推理验收必须由操作者在确认模型空闲、endpoint 可达后单独执行；本仓库不自动探测或切换模型网络。

## 源码与运行数据目录

- Git 工作区：当前仓库 checkout 根目录（`PROJECT_ROOT`）。开发、测试、提交和推送均在此目录完成。
- 私有实例配置：`~/.config/agent-mcp/instance.amd64.json`。
- 运行数据：`~/.local/state/agent-mcp/`，包括 `runtime/`、`host-jobs/`、`native-tasks.json`、`systemd/`、`rendered/`、`rollback/` 和 `credentials/`。
- `~/.local/share/agent-mcp/releases/` 仅用于保留旧版本回滚，不作为开发工作区。
