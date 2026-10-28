# OpenCode 与插件维护

当前 AMD64 Gateway 固定 OpenCode 2.1.2。执行 `bash scripts/opencode-install.sh check` 只检查；执行 `bash scripts/opencode-install.sh install` 才尝试安装。

Host 和每个容器的 OpenCode 版本必须分别核查；升级前备份配置、确认二进制路径及运行会话状态，升级后运行 `./agent-mcp check` 和 `./agent-mcp status`。

用户日常 CLI 的 `plugin` 列表与 Gateway `runtime.plugins` 独立。默认不向后台注入日常插件。对 `opencode-mem`、`billion-context` 等第三方插件先在隔离环境测试同进程加载、工具清单、MCP、持久化、恢复和资源占用；测试通过后再变更后台设置，避免覆盖用户自己的 OpenCode 配置。

任何插件更新需记录版本与锁文件，备份用户配置；在隔离目录执行 npm 安装和自动测试，确认无重复工具注册、权限越界及 Session 恢复问题后安排维护窗口重启。插件安装不应由 Gateway 启动过程隐式触发。

官方文档：https://opencode.ai/docs/
