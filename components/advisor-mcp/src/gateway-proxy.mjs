import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { readSecret } from '../../../src/instance-config.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { z } from 'zod'
import { hostJobDefinitions } from '../../../src/host-jobs.mjs'

export const GATEWAY_TOOL_NAMES = Object.freeze([
  'gateway_status',
  'opencode_start',
  'opencode_continue',
  'opencode_status',
  'opencode_diff',
  'opencode_abort', 'host_exec', 'host_poll', 'host_stop', 'container_list', 'container_exec', 'container_poll', 'container_stop',
])

const taskId = z.string().uuid()
const prompt = z.string().min(1).max(32768)
const variant = z.enum(['low', 'medium', 'high']).optional()

export const GATEWAY_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'gateway_status',
    title: 'Local Gateway status',
    description: 'Read the local Gateway identity and configured capabilities; no secrets are returned.',
    inputSchema: {},
  },
  {
    name: 'opencode_start',
    title: 'Start OpenCode Server task',
    description: 'L2 operation. Starts a native OpenCode session on an explicit Host or registered container. Current full-native baseline is 2.1.2, with the target OS-user permissions and no extra Host sandbox. Each task returns the actual runtime version and selected model.',
    inputSchema: {
      target: z.enum(['container', 'host']),
      container: z.string().max(128).optional(),
      cwd: z.string().min(1).max(4096),
      prompt,
      model: z.string().max(256).optional(),
      variant,
    },
  },
  {
    name: 'opencode_continue',
    title: 'Continue owned OpenCode task',
    description: 'L2 operation. Continues the exact Gateway-managed OpenCode Server session; no implicit model fallback or prompt replay.',
    inputSchema: { task_id: taskId, prompt, variant },
  },
  {
    name: 'opencode_status',
    title: 'Read OpenCode task status',
    description: 'Read Gateway-managed OpenCode task status, or list the caller’s task identities when task_id is omitted.',
    inputSchema: { task_id: taskId.optional() },
  },
  {
    name: 'opencode_diff',
    title: 'Read OpenCode task diff',
    description: 'Read the Gateway-managed OpenCode task diff using the local Gateway’s redaction and container Git rules.',
    inputSchema: { task_id: taskId },
  },
  {
    name: 'opencode_abort',
    title: 'Abort owned OpenCode task',
    description: 'L2 operation. Interrupts the exact Gateway-managed OpenCode task; does not undo edits.',
    inputSchema: { task_id: taskId },
  },
  ...hostJobDefinitions.map(d=>({name:d.name,title:d.name,description:d.description,inputSchema:d.schema.shape})),
  {name:'container_list',title:'Registered containers',description:'Read registered container identities.',inputSchema:{}},
  {name:'container_exec',title:'Container native shell',description:'L2 native shell under the container operating-system user.',inputSchema:{container:z.string(),command:z.string().min(1),cwd:z.string(),wait_ms:z.number().int().min(0).max(2000).optional()}},
  {name:'container_poll',title:'Container task output',description:'Read a managed container task output.',inputSchema:{task_id:z.string()}},
  {name:'container_stop',title:'Stop container task',description:'L2 stop the exact managed container task process group.',inputSchema:{task_id:z.string()}},
])

function privateSingleLinkFile(st, uid) {
  return st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.uid === uid && (st.mode & 0o077) === 0
}

async function loadGatewayClientReference(reference) {
  if (!reference || typeof reference.url !== 'string' || !(typeof reference.token === 'string' || typeof reference.token_file === 'string' && isAbsolute(reference.token_file))) throw Error('GATEWAY_CLIENT_CONFIG_INVALID')
  let url
  try { url = new URL(reference.url) } catch { throw Error('GATEWAY_LOOPBACK_URL_REQUIRED') }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/mcp' || url.username || url.password || url.search || url.hash) throw Error('GATEWAY_LOOPBACK_URL_REQUIRED')
  if (reference.token_file) {
    const tokenStat = await lstat(reference.token_file)
    if (!privateSingleLinkFile(tokenStat, process.getuid())) throw Error('GATEWAY_TOKEN_FILE_PRIVATE_REQUIRED')
  }
  const token = await readSecret(reference, 'token', 'token_file')
  if (token.length < 32) throw Error('GATEWAY_TOKEN_INVALID')
  return Object.freeze({ url: url.toString(), token })
}

export async function loadGatewayClientConfig(configPath) {
  if (!configPath) return null
  if (!isAbsolute(configPath)) throw Error('GATEWAY_CLIENT_CONFIG_ABSOLUTE_REQUIRED')
  const configStat = await lstat(configPath)
  if (!privateSingleLinkFile(configStat, process.getuid())) throw Error('GATEWAY_CLIENT_CONFIG_PRIVATE_REQUIRED')
  let reference
  try { reference = JSON.parse(await readFile(configPath, 'utf8')) } catch { throw Error('GATEWAY_CLIENT_CONFIG_INVALID') }
  return loadGatewayClientReference(reference)
}

export async function loadGatewayClientConfigFromAdvisor(advisorConfig) {
  if (!advisorConfig?.caller || !advisorConfig?.gatewayUrl) return null
  return loadGatewayClientReference({ url: advisorConfig.gatewayUrl, token: advisorConfig.caller.token, token_file: advisorConfig.caller.token_file })
}

function safeCode(error) {
  const code = typeof error?.code === 'string' ? error.code : typeof error?.name === 'string' ? error.name : 'UPSTREAM_ERROR'
  return /^[A-Z0-9_]+$/.test(code) ? code : 'UPSTREAM_ERROR'
}

export async function callGatewayTool(config, name, args) {
  if (!config || !GATEWAY_TOOL_NAMES.includes(name)) return { isError: true, content: [{ type: 'text', text: 'Error: GATEWAY_PROXY_NOT_CONFIGURED' }] }
  const client = new Client({ name: 'agent-mcp-advisor-gateway-proxy', version: '1.3.0' }, { capabilities: {} })
  const transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: { Authorization: 'Bearer ' + config.token } } })
  try {
    await client.connect(transport)
    return await client.callTool({ name, arguments: args })
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: 'Error: GATEWAY_UPSTREAM_' + safeCode(error) }] }
  } finally {
    await client.close().catch(() => {})
  }
}
