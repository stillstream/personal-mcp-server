# Agent MCP Advisor Server

This is the advisor-facing Streamable HTTP MCP server, maintained inside the unified agent-mcp repository. It provides bounded file/Git operations and proxies only the configured Gateway status/OpenCode tools; it does not expose arbitrary shell, Docker, or raw container execution.

## Local request path

ChatGPT Secure MCP Tunnel client → advisor MCP at 127.0.0.1:8787/mcp → Gateway at 127.0.0.1:18879/mcp → Host or allowlisted Container OpenCode Server.

The Tunnel client is a separate component under components/tunnel-client. Its health endpoint is configured in the private instance file (normally 127.0.0.1:38433/readyz).

## Single instance configuration

Both the Gateway and this advisor server read the same private config: ~/.config/agent-mcp/instance.json. Start from config/instance.example.json; keep the private file mode 0600 and never commit credentials.

- callers[].level selects Host L1 (read) or L2 (write/task control).
- host_read_roots and host_write_roots bound Gateway Host tools.
- advisor_mcp.roots and advisor_mcp.write_roots bound the advisor’s named file roots; mutation tools and OpenCode start/continue/abort are exposed only for an L2 caller.
- containers is the Gateway allowlist; Host and Container OpenCode Server backends are configured through agents.host_backends and agents.backends.
- existing_tunnel holds the existing Tunnel ID and API-key file reference. The key value stays in its private file.

The adapter validates loopback-only listeners, canonical directories, root names, operation allowlists, caller level and the upstream Gateway token reference. L1 does not receive file mutation or task-start tools; the Gateway independently enforces the same caller level.

## Lifecycle and tests

From the repository root, the local stack manager is deploy/local-stack.sh. Advisor-only lifecycle commands are:

	export AGENT_MCP_CONFIG="$HOME/.config/agent-mcp/instance.json"
	components/advisor-mcp/start-openai-tunnel.sh up
	components/advisor-mcp/start-openai-tunnel.sh reload-mcp
	components/advisor-mcp/start-openai-tunnel.sh down

Run npm run test:advisor for file/Git, proxy and L1/L2 configuration checks; run npm run test:advisor:lifecycle for a fake-Tunnel start/reload/stop test. These tests use temporary roots and local test ports.

See the root README.md and docs/ARCHITECTURE.md for the complete three-component project layout. The former dsh1/mcp-file-server directory is not the maintained source of truth.
