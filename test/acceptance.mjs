import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const tokenFile = process.env.MCP_TOKEN_FILE || join(homedir(), '.local/share/opencode-mcp/runtime/access-token')
const token = (await readFile(tokenFile, 'utf8')).trim()
const url = process.env.MCP_URL || `http://127.0.0.1:${process.env.MCP_PORT || 18878}/mcp`
const prefix = process.env.MCP_TOOL_PREFIX || 's100'
const client = new Client({ name: 'personal-mcp-smoke', version: '1.0.0' })

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: 'Bearer ' + token } }
  }))
  const tools = (await client.listTools()).tools.map(item => item.name)
  for (const suffix of ['exec', 'poll', 'stop']) {
    if (!tools.includes(`${prefix}_${suffix}`)) {
      throw new Error(`MCP 工具缺失: ${prefix}_${suffix}`)
    }
  }
  console.log(`MCP 工具发现通过：${tools.join(', ')}`)
} finally {
  await client.close()
}
