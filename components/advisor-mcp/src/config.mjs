import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { validateAdvisorPolicy, validateConfigBoundary } from '../../../src/config-policy.mjs'
import { loadInstance } from '../../../src/instance-config.mjs'
import { fileURLToPath } from 'node:url'

export const ADVISOR_FILE_OPERATIONS = Object.freeze([
  'list_files', 'read_file', 'write_file', 'create_directory', 'file_info',
  'search_files', 'search_text', 'git_summary', 'delete_file',
  'delete_directory', 'rename_file',
])
export const ADVISOR_MUTATING_FILE_OPERATIONS = new Set([
  'write_file', 'create_directory', 'delete_file', 'delete_directory', 'rename_file',
])
export const ADVISOR_GATEWAY_TOOLS = Object.freeze([
  'gateway_status', 'opencode_start', 'opencode_continue', 'opencode_status',
  'opencode_diff', 'opencode_abort', 'host_exec', 'host_poll', 'host_stop', 'container_list', 'container_exec', 'container_poll', 'container_stop',
])
const MUTATING_GATEWAY_TOOLS = new Set(['opencode_start', 'opencode_continue', 'opencode_abort', 'host_exec', 'host_stop', 'container_exec', 'container_stop'])

function privateFile(st, uid) {
  return st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.uid === uid && (st.mode & 0o077) === 0
}
function inside(child, parent) {
  const r = relative(parent, child)
  return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r))
}
function overlaps(a, b) { return inside(a, b) || inside(b, a) }

export async function loadAdvisorConfig(configPath = process.env.AGENT_MCP_CONFIG) {
  configPath ||= fileURLToPath(new URL('../../../config/instance.local.json', import.meta.url))
  if (!isAbsolute(configPath)) throw Error('AGENT_MCP_CONFIG_ABSOLUTE_REQUIRED')
  const configStat = await lstat(configPath)
  if (!privateFile(configStat, process.getuid())) throw Error('INSTANCE_CONFIG_PRIVATE_REQUIRED')
  let instance
  instance = await loadInstance(configPath)
  validateAdvisorPolicy(instance)
  const advisor = instance.advisor_mcp
  if (!advisor || advisor.enabled !== true) throw Error('ADVISOR_MCP_CONFIG_REQUIRED')
  const listen = advisor.listen
  const caller = instance.callers.find(x => x.id === advisor.gateway_caller)
  const protectedPaths = await validateConfigBoundary(instance, configPath, fileURLToPath(new URL('../../../', import.meta.url)))
  const roots = new Map()
  for (const [name, path] of Object.entries(advisor.roots)) {
    const st = await lstat(path)
    if (!st.isDirectory() || st.isSymbolicLink()) throw Error('ADVISOR_ROOT_CANONICAL_REQUIRED')
    const canonical = await realpath(path)
    if (protectedPaths.some(p => overlaps(p, canonical))) throw Error('ADVISOR_ROOT_CONTROL_OVERLAP')
    const writeAllowed = caller.level === 'L2' && (instance.permissions?.l2 === 'full' || advisor.write_roots.includes(name))
    roots.set(name, { configured: resolve(path), real: canonical, writeAllowed })
  }
  if(caller.level === 'L2' && instance.permissions?.l2 === 'full') roots.set('host',{configured:'/',real:'/',writeAllowed:true})
  const writeRoots = new Set([...roots].filter(([, root]) => root.writeAllowed).map(([name]) => name))
  const fileOperations = advisor.file_operations
    .filter(name => (!ADVISOR_MUTATING_FILE_OPERATIONS.has(name) || writeRoots.size > 0) && (caller.level === 'L2' || !ADVISOR_MUTATING_FILE_OPERATIONS.has(name)))
  const gatewayTools = advisor.gateway_tools
    .filter(name => caller.level === 'L2' || !MUTATING_GATEWAY_TOOLS.has(name))
  const gatewayHost = instance.listen.host
  const gatewayUrl = 'http://' + gatewayHost + ':' + instance.listen.port + '/mcp'
  return Object.freeze({ configPath: resolve(configPath), instance, advisor, listen, roots, writeRoots, caller, fileOperations, gatewayTools, enabledOperations: new Set([...fileOperations, ...gatewayTools]), gatewayUrl })
}
