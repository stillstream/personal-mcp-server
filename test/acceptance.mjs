import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { readFile } from 'node:fs/promises'

const token = (await readFile(new URL('../runtime/access-token', import.meta.url), 'utf8')).trim()
const url = process.env.MCP_URL || 'http://127.0.0.1:18878/mcp'
const client = new Client({ name: 's100-smoke', version: '1.0.0' })
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: 'Bearer ' + token } }
  }))
  const names = (await client.listTools()).tools.map(tool => tool.name)
  for (const name of ['s100_exec', 's100_poll', 's100_stop']) {
    if (!names.includes(name)) throw new Error('Missing tool: ' + name)
  }
  console.log('MCP tool discovery OK:', names.join(', '))
} finally {
  await client.close()
}
