# Tunnel Client Component

The OpenAI Secure MCP Tunnel runtime is a pinned third-party binary, not part of the Gateway implementation. The local packaged copy lives under components/tunnel-client/runtime/ (source package v0.0.14; embedded cloudflared build 2026.8.2). The adjacent cloudflared-manifest.json, LICENSE, NOTICE and SPDX files record provenance and licenses. Verify the binary SHA-256 against the release manifest before replacing it.

The Tunnel client connects to the advisor MCP loopback endpoint 127.0.0.1:8787/mcp; the advisor MCP proxies the selected Gateway tools to 127.0.0.1:18879/mcp. The Tunnel health endpoint is 127.0.0.1:38433/readyz.

Tunnel ID and Runtime API key are deployment data. Keep them out of Git and logs: use the private instance config for the ID and an absolute 0600 api_key_file reference for the key. The launcher passes the file reference to the official client; it never reads the key into a command-line value.

Lifecycle is coordinated by deploy/local-stack.sh; advisor-only compatibility operations remain in components/advisor-mcp/start-openai-tunnel.sh. Do not create a second Tunnel ID when refreshing the local stack.
