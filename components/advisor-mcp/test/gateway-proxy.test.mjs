import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { callGatewayTool, loadGatewayClientConfig } from '../src/gateway-proxy.mjs'

function text(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function privateFile(mode = 0o600) {
  return (stat) => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && ((stat.mode & 0o777) === mode)
}

test('Gateway proxy uses private reference credentials and forwards only the OpenCode allowlist', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-gateway-proxy-'))
  await chmod(dir, 0o700)
  const tokenFile = join(dir, 'gateway.token')
  const configFile = join(dir, 'gateway-client.json')
  const token = 'unit-test-gateway-token-0123456789abcdef'
  await writeFile(tokenFile, token + '\n', { mode: 0o600 })
  await chmod(tokenFile, 0o600)

  let authorized = false
  let receivedStart = null
  const http = createServer(async (req, res) => {
    if (req.url?.split('?')[0] !== '/mcp') { res.writeHead(404).end(); return }
    if (req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401).end('unauthorized'); return }
    authorized = true
    const server = new McpServer({ name: 'fake-server1-gateway', version: 'test' }, { capabilities: { tools: {} } })
    server.registerTool('gateway_status', { title: 'status', description: 'fake status', inputSchema: {} }, async () => text({ machine_id: 'aifly-server1' }))
    server.registerTool('opencode_start', { title: 'start', description: 'fake start', inputSchema: { target: z.enum(['host', 'container']), cwd: z.string(), prompt: z.string() } }, async (args) => { receivedStart = args; return text({ task_id: '00000000-0000-4000-8000-000000000001', target: args.target, cwd: args.cwd }) })
    const transport = new StreamableHTTPServerTransport({})
    res.on('close', () => { void transport.close(); void server.close() })
    try { await server.connect(transport); await transport.handleRequest(req, res) }
    catch (error) { if (!res.headersSent) res.writeHead(500); if (!res.writableEnded) res.end('fake upstream failed') }
  })
  await new Promise((resolve, reject) => http.listen(0, '127.0.0.1', resolve).once('error', reject))
  t.after(async () => { await new Promise(resolve => http.close(resolve)); await rm(dir, { recursive: true, force: true }) })
  const port = http.address().port
  await writeFile(configFile, JSON.stringify({ url: 'http://127.0.0.1:' + port + '/mcp', token_file: tokenFile }) + '\n', { mode: 0o600 })
  await chmod(configFile, 0o600)

  const config = await loadGatewayClientConfig(configFile)
  assert.ok(config)
  const status = await callGatewayTool(config, 'gateway_status', {})
  assert.equal(authorized, true)
  assert.equal(JSON.parse(status.content[0].text).machine_id, 'aifly-server1')
  const args = { target: 'container', cwd: '/tmp', prompt: 'read-only-smoke' }
  const start = await callGatewayTool(config, 'opencode_start', args)
  assert.deepEqual(receivedStart, args)
  assert.equal(JSON.parse(start.content[0].text).target, 'container')
  assert.equal(privateFile()(await (await import('node:fs/promises')).lstat(tokenFile)), true)
})

test('Gateway proxy rejects non-loopback upstreams', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-gateway-proxy-reject-'))
  try {
    await chmod(dir, 0o700)
    const tokenFile = join(dir, 'gateway.token')
    const configFile = join(dir, 'gateway-client.json')
    await writeFile(tokenFile, 'unit-test-gateway-token-0123456789abcdef\n', { mode: 0o600 })
    await chmod(tokenFile, 0o600)
    await writeFile(configFile, JSON.stringify({ url: 'https://example.invalid/mcp', token_file: tokenFile }) + '\n', { mode: 0o600 })
    await chmod(configFile, 0o600)
    await assert.rejects(() => loadGatewayClientConfig(configFile), /GATEWAY_LOOPBACK_URL_REQUIRED/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
