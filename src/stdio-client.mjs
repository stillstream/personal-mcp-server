import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFile } from 'node:fs/promises'
const token = (await readFile(new URL('../runtime/access-token', import.meta.url), 'utf8')).trim()
const upstream = new Client({name:'s100-stdio-client',version:'1.0.0'})
await upstream.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:18878/mcp'), {requestInit:{headers:{Authorization:'Bearer '+token}}}))
const server = new Server({name:'s100-opencode-mcp-stdio',version:'1.0.0'},{capabilities:{tools:{}}})
server.setRequestHandler(ListToolsRequestSchema, async () => upstream.listTools())
server.setRequestHandler(CallToolRequestSchema, async (request, extra) => upstream.callTool(request.params, undefined, {timeout:65000,signal:extra.signal}))
await server.connect(new StdioServerTransport())
let closing=false
async function close(){if(closing)return;closing=true;await Promise.allSettled([upstream.close(),server.close()]);process.exit(0)}
process.stdin.on('end',()=>void close())
process.on('SIGTERM',()=>void close())
process.on('SIGINT',()=>void close())
