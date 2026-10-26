#!/usr/bin/env node
import { chmod, lstat, mkdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const home = homedir()
const positional = process.argv.slice(2).filter(x => x !== '--dry-run')
const dryRun = process.argv.includes('--dry-run')
if (!positional[0]) throw Error('EXPLICIT_LEGACY_SOURCE_REQUIRED_USE_PROJECT_CONFIG_INIT')
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(positional[0])
const destination = resolve(positional[1] || projectRoot + '/config/instance.local.json')
const stateDir = resolve(positional[2] || projectRoot + '/.local/legacy-advisor')
const fileOps = ['list_files', 'read_file', 'write_file', 'create_directory', 'file_info', 'search_files', 'search_text', 'git_summary', 'delete_file', 'delete_directory', 'rename_file']
const gatewayOps = ['gateway_status', 'opencode_start', 'opencode_continue', 'opencode_status', 'opencode_diff', 'opencode_abort']
const mutationOps = new Set(['write_file', 'create_directory', 'delete_file', 'delete_directory', 'rename_file'])

async function requirePrivateFile(path, label) {
  if (!path || !isAbsolute(path)) throw Error(label + '_ABSOLUTE_REQUIRED')
  const st = await lstat(path)
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.uid !== process.getuid() || (st.mode & 0o077) !== 0) throw Error(label + '_PRIVATE_FILE_REQUIRED')
}
function selectedEnv(bytes, keys) {
  const wanted = new Set(keys), out = {}
  for (const item of bytes.toString('utf8').split('\0')) {
    const i = item.indexOf('=')
    if (i > 0 && wanted.has(item.slice(0, i))) out[item.slice(0, i)] = item.slice(i + 1)
  }
  return out
}
function argValue(args, key) {
  const i = args.indexOf(key)
  if (i >= 0 && args[i + 1]) return args[i + 1]
  const pair = args.find(x => x.startsWith(key + '='))
  return pair ? pair.slice(key.length + 1) : ''
}
async function processContext(name, envKeys = []) {
  const pidPath = stateDir + '/' + name + '.pid'
  const pid = Number((await readFile(pidPath, 'utf8')).trim())
  if (!Number.isSafeInteger(pid) || pid < 2) throw Error('LEGACY_' + name.toUpperCase() + '_PID_INVALID')
  const [cmdBytes, envBytes, statusText, cwd] = await Promise.all([
    readFile('/proc/' + pid + '/cmdline'),
    envKeys.length ? readFile('/proc/' + pid + '/environ') : Promise.resolve(Buffer.alloc(0)),
    readFile('/proc/' + pid + '/status', 'utf8'),
    readlink('/proc/' + pid + '/cwd'),
  ])
  const uidLine = statusText.split('\n').find(x => x.startsWith('Uid:')) || ''
  const uid = Number(uidLine.trim().split(/\s+/)[1])
  if (uid !== process.getuid()) throw Error('LEGACY_' + name.toUpperCase() + '_OWNER_MISMATCH')
  return { pid, cwd, args: cmdBytes.toString('utf8').split('\0').filter(Boolean), env: selectedEnv(envBytes, envKeys) }
}

await requirePrivateFile(source, 'SOURCE_INSTANCE')
const sourceConfig = JSON.parse(await readFile(source, 'utf8'))
const mcp = await processContext('mcp', ['MCP_ROOTS_JSON', 'MCP_ENABLED_OPERATIONS', 'MCP_HOST', 'MCP_PORT', 'MCP_PATH'])
const tunnel = await processContext('tunnel')
if (!mcp.args.some(x => x === 'src/server.mjs' || x.endsWith('/src/server.mjs')) || !mcp.cwd.endsWith('/mcp-file-server')) throw Error('LEGACY_ADVISOR_PROCESS_UNVERIFIED')
if (!tunnel.args[0]?.includes('tunnel-client-runtime-cloudflared') || !tunnel.cwd.endsWith('/mcp-file-server')) throw Error('LEGACY_TUNNEL_PROCESS_UNVERIFIED')
const tunnelId = argValue(tunnel.args, '--control-plane.tunnel-id')
const tunnelServer = argValue(tunnel.args, '--mcp.server-url')
const targetUrl = (tunnelServer.startsWith('url=') ? tunnelServer.slice(4) : tunnelServer) || 'http://127.0.0.1:8787/mcp'
const tunnelHealth = argValue(tunnel.args, '--health.listen-addr') || '127.0.0.1:38433'
if (!tunnelId) throw Error('CURRENT_TUNNEL_ID_UNAVAILABLE')
const keyArg = argValue(tunnel.args, '--control-plane.api-key')
const keyPathFromProcess = keyArg.startsWith('file:') ? keyArg.slice(5) : ''
const apiKeyFile = sourceConfig.existing_tunnel?.api_key_file || keyPathFromProcess
if (!apiKeyFile || (keyPathFromProcess && resolve(apiKeyFile) !== resolve(keyPathFromProcess))) throw Error('CURRENT_TUNNEL_API_KEY_FILE_MISMATCH')
await requirePrivateFile(apiKeyFile, 'TUNNEL_API_KEY')
const listenHost = mcp.env.MCP_HOST || '127.0.0.1'
const listenPort = Number(mcp.env.MCP_PORT || 8787)
const listenPath = mcp.env.MCP_PATH || '/mcp'
if (listenHost !== '127.0.0.1' || !Number.isInteger(listenPort) || listenPath !== '/mcp') throw Error('LEGACY_ADVISOR_LISTENER_UNEXPECTED')
if (targetUrl !== 'http://127.0.0.1:' + listenPort + listenPath) throw Error('CURRENT_TUNNEL_TARGET_MISMATCH')
let roots
try { roots = JSON.parse(mcp.env.MCP_ROOTS_JSON || '') } catch { throw Error('LEGACY_ADVISOR_ROOTS_UNAVAILABLE') }
if (!roots || Array.isArray(roots) || typeof roots !== 'object' || !Object.keys(roots).length) throw Error('LEGACY_ADVISOR_ROOTS_INVALID')
for (const [name, path] of Object.entries(roots)) {
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name) || typeof path !== 'string' || !isAbsolute(path)) throw Error('LEGACY_ADVISOR_ROOT_INVALID')
  const st = await lstat(path)
  if (!st.isDirectory() || st.isSymbolicLink()) throw Error('LEGACY_ADVISOR_ROOT_NOT_CANONICAL')
}
const oldOperations = (mcp.env.MCP_ENABLED_OPERATIONS || '').split(',').map(x => x.trim()).filter(Boolean)
const advisorOperations = oldOperations.length ? oldOperations : [...fileOps, ...gatewayOps]
const existingTunnel = { ...(sourceConfig.existing_tunnel || {}), id: tunnelId, api_key_file: apiKeyFile, old_target: targetUrl }
const configuredFileOperations = advisorOperations.filter(x => fileOps.includes(x))
const fileOperations = configuredFileOperations.length ? configuredFileOperations : fileOps
const gatewayTools = advisorOperations.filter(x => gatewayOps.includes(x))
const privateConfig = {
  ...sourceConfig,
  machine_id: hostname().replace(/-shadow$/, ''),
  existing_tunnel: existingTunnel,
  advisor_mcp: {
    enabled: true,
    listen: { host: listenHost, port: listenPort, path: listenPath },
    gateway_caller: 'chatgpt',
    roots,
    write_roots: fileOperations.some(x => mutationOps.has(x)) ? Object.keys(roots) : [],
    file_operations: fileOperations,
    gateway_tools: gatewayTools.length ? gatewayTools : gatewayOps,
  },
  tunnel_client: {
    enabled: true,
    binary: 'components/tunnel-client/runtime/tunnel-client-runtime-cloudflared',
    health_addr: tunnelHealth,
    target_url: targetUrl,
  },
}
if (!privateConfig.callers?.some(x => x.id === 'chatgpt')) throw Error('CHATGPT_CALLER_REQUIRED')
const destinationExists = await lstat(destination).then(() => true).catch(e => e.code === 'ENOENT' ? false : Promise.reject(e))
if (destinationExists && !dryRun) throw Error('CENTRAL_INSTANCE_ALREADY_EXISTS')
const summary = { destination, destination_exists: destinationExists, machine_id: privateConfig.machine_id, advisor_root_names: Object.keys(roots), containers: (privateConfig.containers || []).map(x => x.name), gateway_caller: 'chatgpt', tunnel_id_preserved: true, api_key_file_reference: true, dry_run: dryRun }
if (dryRun) { console.log(JSON.stringify(summary)); process.exit(0) }
await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
await chmod(dirname(destination), 0o700)
await writeFile(destination, JSON.stringify(privateConfig, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
await chmod(destination, 0o600)
console.log(JSON.stringify(summary))
