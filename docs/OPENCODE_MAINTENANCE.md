# OpenCode 2.1.2 安装与插件维护（AMD64）

## 版本边界

本项目的 Gateway 后端固定 OpenCode **2.1.2** 与 @opencode/client 2.1.2。OpenCode 官方通用安装入口可能提供 V1，不能用于本项目的固定版本部署。安装所需二进制应通过已核实的 V2 发布渠道取得，并独立核对 SHA-256。

## 安装和升级

`bash scripts/opencode-install.sh check` 只查询本机目标目录，绝不修改安装。

`install` 模式要求显式提供 `OPENCODE_BINARY`（经确认的 Linux x86_64 OpenCode 2.1.2 二进制绝对路径）与 `OPENCODE_SHA256`（独立确认的 SHA-256）。例如：

```bash
OPENCODE_BINARY=/path/to/verified/opencode \
OPENCODE_SHA256='<verified_sha256>' \
bash scripts/opencode-install.sh install
```

默认安装到用户 `~/.local/bin/opencode`。如目标已存在，拒绝覆盖。升级先在隔离目录完成并切换用户服务引用，不覆盖用户日常 CLI。每个 Docker 容器需要单独核对相同版本；不要自动复制或覆盖容器内原有二进制。

## 插件管理

`bash scripts/opencode-plugins.sh status` 仅列出已存在的配置文件；执行 `install` 才会在指定用户配置目录运行 `npm ci --ignore-scripts`。此操作要求有 `package.json` 和有效 lockfile，且在执行前检查第三方依赖。脚本不会写入 OpenCode JSON/JSONC 的插件列表，不会调用 Gateway restart。

CLI 的 `plugin` 列表与后台实例 `runtime.plugins` 是独立配置。默认后台插件为空；不得把 `opencode-mem`、`billion-context` 等用户插件未经验证直接注入 Gateway。插件应先完成同进程注册、MCP 工具名冲突、权限、记忆持久化、Session 恢复与资源消耗测试。

## 发布验收

1. 检查固定 OpenCode 版本、SDK、容器目标以及配置备份。
2. 在与生产隔离的测试环境运行 `npm test`、Advisor 测试和 Session 并发测试。
3. 确认 Start、Continue、Abort、同 Session 互斥、跨目标容量和失败恢复。
4. 检查 Tunnel/Advisor 无新增非预期权限，确认所有安装脚本默认无副作用。
5. 安排维护窗口部署；不得在有活动任务时未经授权重启生产服务。

官方 V1/V2 安装入口差异见 https://opencode.ai/docs 。
