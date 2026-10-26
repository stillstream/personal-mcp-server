# Agent MCP 本机统一架构与安全边界

> **参考资料范围（2026-10-22）**：下文继承自远端 server1 工程，历史服务状态、私有路径和实测结果不代表本机结果。本机配置入口、操作与当前验收以 [README](../README.md) 和本文件新增的“本机统一配置验收”节为准；不要直接执行旧用户目录部署命令。

## 当前请求链

ChatGPT → OpenAI Secure MCP Tunnel client → advisor MCP Server → agent-mcp Gateway → Host OpenCode Server / dlvins-dev Container OpenCode Server。

代码、配置样例、测试和部署入口统一维护在 /home/wkw/workspace/project/agent/agent-mcp。Gateway、advisor MCP、Tunnel client 是三个独立运行组件；Host/Container OpenCode Server 是 Gateway 的后端，不是另外的 MCP 入口。

| 组件 | 工程位置 | 运行接口与职责 |
|---|---|---|
| Gateway | src/、deploy/ | 回环 127.0.0.1:18879/mcp；认证 caller，执行 Host 权限策略、容器白名单和 OpenCode Server API 调用 |
| Advisor MCP | components/advisor-mcp/ | 回环 127.0.0.1:8787/mcp；命名根文件/Git工具；仅代理配置允许的 Gateway status/OpenCode 工具 |
| Tunnel client | components/tunnel-client/ | 固定官方 runtime 与来源/许可清单；连接 8787 advisor MCP，health 在 38433 |
| OpenCode 后端 | 私有 instance 配置引用 | Host 与 dlvins-dev Container 均使用 OpenCode Server API；Container Server 通过 deploy/opencode-v2-server.mjs 管理 |

最终运行模型是单一本机 Gateway/advisor/Tunnel stack；不部署 shadow/并行实例，不操作 lap1，不走 Tailscale。现有 Tunnel ID 与 API key 文件引用保持不变。

## 单一私有实例配置

配置样例：config/instance.example.json。本机唯一配置：~/.config/agent-mcp/instance.json，必须由 wkw 持有且权限 0600；该文件不进入 Git。Gateway、advisor MCP、Tunnel lifecycle manager 均读取同一实例文件。

- callers[].level 定义调用者权限：L1 只读；L2 才能使用 Host 写操作和可修改任务的 OpenCode 工具。
- host_read_roots / host_write_roots 控制 Gateway 的 Host 白名单；Containers 列表控制 Docker 名称白名单。
- advisor_mcp.roots / write_roots 控制 advisor 文件根；gateway_caller 绑定现有 caller 的 L1/L2，L1 不会注册文件修改或 OpenCode start/continue/abort 工具。
- agents.host_backends / agents.backends 分别引用 Host 与 Container OpenCode Server 后端记录。容器名单只限制目标，不等同容器内无 root 或无可写挂载。
- existing_tunnel 保存既有 Tunnel ID 与 api_key_file 引用；不把 API key 值放入配置、命令日志或仓库。

## 权限不变量

1. Gateway Host L1/L2 由 caller 配置与两组 Host root 白名单共同决定；Host 写操作在服务端校验，不能由提示词降级绕过。
2. Container 工具只访问配置名单；Gateway 启动时检查 Docker inspect 的 privileged、PID namespace、docker.sock 和控制平面挂载风险，目标访问时重新核对容器身份。
3. Native OpenCode V2 连接在请求前核验私有 connection 记录、container 内 marker PID/start-time/进程组，并通过认证的 OpenCode Server API。身份检查失败即拒绝，不把 health 200 当作任务成功。
4. Tunnel client 只连接本机 advisor MCP；不代理任意 shell，不改 OpenAI Tunnel ID。

## 维护与回滚

- 完整回归：npm test；advisor 假 Tunnel 生命周期：npm run test:advisor:lifecycle。
- 本机无副作用预检：deploy/local-stack.sh preflight；运行状态验收：deploy/local-stack.sh verify。
- 本机统一启停/切换：deploy/local-stack.sh start|stop|cutover；失败回退：deploy/local-stack.sh rollback <manifest>。
- install.sh / upgrade.sh 生成并切换由 Git commit 固定的本机 release；rollback manifest 保留旧 release/config 路径。旧 mcp-file-server 工作区仅用于迁移回退，不是维护源。
- 切换后的验收分层：Gateway identity/health、advisor tools/list、Tunnel /readyz、Host/Container Native server.info；模型推理另行在队列空闲时验证，不作为 health 的替代。
