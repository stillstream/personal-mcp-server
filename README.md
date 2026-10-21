# personal-mcp-server

A private, maintainable snapshot of the **running RDK S100-1 MCP execution service** (2026-10-21). It provides a high-trust remote shell bridge for ChatGPT / other MCP clients and optional OpenCode orchestration. The runtime S100 service is not changed by this repository.

## Status and architecture

- Implemented: `s100_exec`, `s100_poll`, `s100_stop` over authenticated Streamable HTTP.
- Access: executes with the Linux account running the service (`sunrise` on S100), **not root by default**, with no project-directory whitelist.
- S100 loopback MCP: `127.0.0.1:18878/mcp` for ChatGPT tunnel; optional LAN MCP: `0.0.0.0:18879/mcp` (authenticated).
- Optional OpenCode HTTP service: `127.0.0.1:4096`. OpenCode normally uses its built-in shell/file tools; it does not need to connect back to this MCP.
- Planned, **not implemented**: restricted deployment profile for host/container with operating-system-enforced boundaries. Do not treat current code as sandboxed.

## Files

- `src/server.mjs`: MCP HTTP server and task lifecycle (`exec`, `poll`, `stop`).
- `src/stdio-client.mjs`: stdio-to-HTTP compatibility bridge.
- `bin/`: S100 OpenCode and tunnel launch scripts, based on the deployed version.
- `systemd/`: S100 user-service definitions (reference deployment).
- `test/acceptance.mjs`: non-invasive MCP tool discovery smoke test; requires running local MCP service and token.

## S100 installation (existing deployment layout)

Requires Node >=22.19, npm, the separately installed OpenCode CLI/server 2.0.32, and the ChatGPT Tunnel Client runtime when tunnel access is desired. Vendor tunnel binaries and OpenCode binaries are **not** distributed here.

1. Copy the repository source into `~/.local/share/opencode-mcp/` on the target S100 system and run `npm ci`. **Do not overwrite a running deployment without an explicit maintenance plan.**
2. Provision `runtime/access-token` for MCP authentication (mode 0600), `runtime/opencode-password` for OpenCode (0600), and `runtime/control-plane-api-key` for the tunnel (0600). Never commit these files. The MCP server can create its own access token on first start.
3. Put the four `systemd/*.service` units into `~/.config/systemd/user/`; adjust absolute paths/ports for the target account. For the tunnel unit, supply `CHATGPT_TUNNEL_ID` through a local user-service override (`systemctl --user edit s100-opencode-chatgpt-tunnel.service`), **not** through Git.
4. Enable only the services actually needed; verify `GET http://127.0.0.1:18878/healthz` and authenticate to the MCP endpoint. `npm test` checks authentication and MCP tool discovery without executing shell commands.

The current S100 deployment uses a separate tunnel client and MCP server on the **same machine**. Copying this repository does not create or migrate a ChatGPT tunnel ID. Each machine needs its own tunnel registration.

## Security and maintenance

- Treat the bearer token as remote command execution authorization. Private GitHub repositories are **not** secret stores. All credentials remain in `runtime/` outside Git.
- The LAN listener binds all interfaces: restrict network exposure to trusted LAN/VPN; do not publicly forward port 18879.
- Changes to S100 runtime are manual/explicit; no auto-deployment from GitHub in the initial baseline.
- Scope: preserve this proven S100 baseline first; introduce optional trusted/restricted profiles in later, reviewed changes rather than silently changing behavior.
