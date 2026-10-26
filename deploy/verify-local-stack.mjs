import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadAdvisorConfig } from '../components/advisor-mcp/src/config.mjs'

const configPath = process.env.AGENT_MCP_CONFIG
const runtime = await loadAdvisorConfig(configPath)
const instance = runtime.instance
const gateway = new URL(runtime.gatewayUrl)
const advisorUrl = 'http://' + runtime.listen.host + ':' + runtime.listen.port + runtime.listen.path
const health = await fetch('http://' + runtime.listen.host + ':' + runtime.listen.port + '/healthz', { signal: AbortSignal.timeout(3000) })
if (!health.ok) throw Error('ADVISOR_HEALTH_FAILED')
const healthBody = await health.json()
const toolsClient = new Client({ name: 'agent-mcp-local-stack-check', version: '1.3.0' }, { capabilities: {} })
const transport = new StreamableHTTPClientTransport(new URL(advisorUrl), { requestInit: {} })
try {
  await toolsClient.connect(transport)
  const catalog = await toolsClient.listTools()
  const names = catalog.tools.map(tool => tool.name)
  for (const name of runtime.enabledOperations) if (!names.includes(name)) throw Error('ADVISOR_TOOL_MISSING:' + name)
  if (!names.includes('list_allowed_operations')) throw Error('ADVISOR_CATALOG_TOOL_MISSING')
  const status = await toolsClient.callTool({ name: 'gateway_status', arguments: {} })
  const statusText = status.content?.find(item => item.type === 'text')?.text || ''
  const wrapped = JSON.parse(statusText)
  if (wrapped.ok !== true || wrapped.result?.machine_id !== instance.machine_id) throw Error('GATEWAY_IDENTITY_MISMATCH')
  const allowedContainers = (instance.containers || []).map(item => item.name)
  for (const name of allowedContainers) if (!(wrapped.result?.containers || []).includes(name)) throw Error('GATEWAY_CONTAINER_MISSING:' + name)
  const tunnelHealth = await fetch('http://' + instance.tunnel_client.health_addr + '/readyz', { signal: AbortSignal.timeout(3000) })
  if (!tunnelHealth.ok) throw Error('TUNNEL_HEALTH_FAILED')
  const tunnelText = await tunnelHealth.text()
  if (!tunnelText.toLowerCase().includes('ready')) throw Error('TUNNEL_NOT_READY')
  console.log(JSON.stringify({ status: 'PASS', scope: 'local-components-only', tunnel_control_plane_auth: 'NOT_VERIFIED', external_mcp_e2e: 'NOT_VERIFIED', machine_id: wrapped.result.machine_id, gateway: gateway.origin, advisor: advisorUrl, advisor_tools: names.length, advisor_roots: [...runtime.roots.keys()], containers: allowedContainers, tunnel: 'ready' }))
} finally {
  await toolsClient.close().catch(() => {})
}
