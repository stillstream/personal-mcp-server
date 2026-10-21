import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
const tokenFile = process.env.MCP_TOKEN_FILE || join(homedir(), '.local/share/opencode-mcp/runtime/access-token')
const token = (await readFile(tokenFile, 'utf8')).trim()
const upstream = new Client({name:'personal-stdio-client',version:'1.0.0'})
await upstream.connect(new StreamableHTTPClientTransport(new URL(process.env.MCP_URL || `http://127.0.0.1:${process.env.MCP_PORT || 18878}/mcp`), {requestInit:{headers:{Authorization:'Bearer '+token}}}))
const server = new Server({name:'personal-mcp-stdio',version:'1.0.0'},{capabilities:{tools:{}}})
server.setRequestHandler(ListToolsRequestSchema, async () => upstream.listTools())
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => upstream.callTool(request.params, undefined, {timeout:65000,signal:extra.signal}))
await server.connect(new StdioServerTransport())
let closing=false
async function close(){if(closing)return;closing=true;await Promise.allSettled([upstream.close(),server.close()]);process.exit(0)}
process.stdin.on('end',()=>void close())
process.on('SIGTERM',()=>void close())
process.on('SIGINT',()=>void close())
