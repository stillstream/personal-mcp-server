import { createServer } from 'node:http'
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, readdir, opendir, stat, lstat, realpath, unlink, rename, rmdir } from 'node:fs/promises'
import { constants as fsConstants, existsSync } from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { GATEWAY_TOOL_DEFINITIONS, GATEWAY_TOOL_NAMES, callGatewayTool, loadGatewayClientConfig, loadGatewayClientConfigFromAdvisor } from './gateway-proxy.mjs'
import { ADVISOR_FILE_OPERATIONS, loadAdvisorConfig } from './config.mjs'

const INSTANCE_CONFIG_PATH = process.env.AGENT_MCP_CONFIG || ''
const ADVISOR_CONFIG = INSTANCE_CONFIG_PATH ? await loadAdvisorConfig(INSTANCE_CONFIG_PATH) : null
const FULL_L2 = ADVISOR_CONFIG?.caller.level === 'L2' && ADVISOR_CONFIG.instance.permissions?.l2 === 'full'
const HOST = ADVISOR_CONFIG?.listen.host || process.env.MCP_HOST || '127.0.0.1'
const PORT = Number(ADVISOR_CONFIG?.listen.port || process.env.MCP_PORT || 8787)
const MCP_PATH = ADVISOR_CONFIG?.listen.path || process.env.MCP_PATH || '/mcp'
const TOKEN = ADVISOR_CONFIG ? await (await import('../../../src/instance-config.mjs')).readSecret(ADVISOR_CONFIG.caller, 'token', 'token_file') : process.env.MCP_ACCESS_TOKEN || ''
const MAX_READ_BYTES = Number(process.env.MCP_MAX_READ_BYTES || 2 * 1024 * 1024)
const DEFAULT_ROOT = resolve(process.env.MCP_ROOT || resolve(process.cwd(), 'runtime-share'))
const FILE_DEFAULT_OPERATIONS = ADVISOR_CONFIG?.fileOperations || ['list_files', 'read_file', 'write_file', 'create_directory', 'file_info', 'search_files', 'search_text', 'git_summary']
const GATEWAY_CLIENT_CONFIG_PATH = process.env.AGENT_MCP_GATEWAY_CLIENT_CONFIG || ''
const GATEWAY_PROXY_CONFIG = ADVISOR_CONFIG ? await loadGatewayClientConfigFromAdvisor(ADVISOR_CONFIG) : await loadGatewayClientConfig(GATEWAY_CLIENT_CONFIG_PATH)
const ACTIVE_GATEWAY_TOOL_NAMES = ADVISOR_CONFIG?.gatewayTools || (GATEWAY_PROXY_CONFIG ? GATEWAY_TOOL_NAMES : [])
const DEFAULT_OPERATIONS = [...FILE_DEFAULT_OPERATIONS, ...ACTIVE_GATEWAY_TOOL_NAMES]
const VALID_OPERATIONS = new Set([...ADVISOR_FILE_OPERATIONS, ...GATEWAY_TOOL_NAMES])
const execFile = promisify(execFileCallback)
const MAX_SEARCH_FILE_BYTES = 512 * 1024
const MAX_SEARCH_TOTAL_BYTES = 16 * 1024 * 1024
const MAX_SEARCH_FILES = 500
const SEARCH_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.csv', '.xml', '.html', '.css', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py', '.sh', '.log'])
const requestedOperations = (process.env.MCP_ENABLED_OPERATIONS || DEFAULT_OPERATIONS.join(','))
  .split(',').map(value => value.trim()).filter(Boolean)
const ENABLED_OPERATIONS = new Set(requestedOperations.filter(value => VALID_OPERATIONS.has(value) && (!ADVISOR_CONFIG || DEFAULT_OPERATIONS.includes(value))))
let lastRegisteredOperations = []

if (!TOKEN) {
  console.error('MCP_ACCESS_TOKEN is required; refusing to start without authentication')
  process.exit(2)
}

function parseRoots() {
  if (ADVISOR_CONFIG) return [...ADVISOR_CONFIG.roots].map(([name, root]) => [name, root.configured])
  let configured
  if (process.env.MCP_ROOTS_JSON) {
    try { configured = JSON.parse(process.env.MCP_ROOTS_JSON) } catch { throw new Error('MCP_ROOTS_JSON must be a JSON object: {"name":"/absolute/path"}') }
  } else configured = { workspace: DEFAULT_ROOT }
  if (!configured || Array.isArray(configured) || typeof configured !== 'object') throw new Error('MCP_ROOTS_JSON must be a JSON object')
  const entries = Object.entries(configured)
  if (entries.length === 0) throw new Error('at least one MCP root is required')
  for (const [name, path] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)) throw new Error(`invalid root name: ${name}`)
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`root ${name} must use an absolute path`)
  }
  return entries
}

const ROOTS = new Map()
for (const [name, path] of parseRoots()) {
  const central = ADVISOR_CONFIG?.roots.get(name)
  if (!central) await mkdir(path, { recursive: true })
  ROOTS.set(name, { configured: resolve(path), real: central?.real || await realpath(path), writeAllowed: central?.writeAllowed ?? true })
}

function text(value) { return { content: [{ type: 'text', text: String(value) }] } }
function error(message) { return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] } }
function inside(candidate, base) {
  const rel = relative(base, candidate)
  return rel === '' || (rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
function rootSummary() {
  return Object.fromEntries([...ROOTS].map(([name, root]) => [name, root.real]))
}
function parseVirtualPath(input, { allowMissing = false } = {}) {
  if (typeof input !== 'string' || input.length === 0) throw new Error('path must be a non-empty relative path')
  if (FULL_L2) {
    const parts=input.split('/').filter(Boolean);const alias=!isAbsolute(input)&&ROOTS.has(parts[0])?parts.shift():'host';
    const candidate=isAbsolute(input)?resolve(input):resolve(ROOTS.get(alias).real,parts.join('/')||'.');
    const root=ROOTS.get('host');return{rootName:'host',root,candidate,relativePath:relative('/',candidate)||'.',path:candidate};
  }
  if (isAbsolute(input)) throw new Error('absolute paths are not allowed')
  const clean = input.replace(/^\.\//, '')
  const parts = clean.split('/').filter(Boolean)
  let rootName
  let relativeInput
  if (ROOTS.has(parts[0])) {
    rootName = parts.shift()
    relativeInput = parts.join('/') || '.'
  } else if (ROOTS.size === 1) {
    rootName = ROOTS.keys().next().value
    relativeInput = clean || '.'
  } else {
    throw new Error(`path must start with one of: ${[...ROOTS.keys()].join(', ')}`)
  }
  const root = ROOTS.get(rootName)
  const candidate = resolve(root.real, relativeInput)
  if (!inside(candidate, root.real)) throw new Error(`path escapes whitelist root ${rootName}`)
  return { rootName, root, candidate, relativePath: relative(root.real, candidate) || '.', path: `${rootName}/${relative(root.real, candidate) || '.'}` }
}
async function existingPath(input) {
  const p = parseVirtualPath(input)
  const actual = await realpath(p.candidate)
  if (!inside(actual, p.root.real)) throw new Error(`symlink resolves outside whitelist root ${p.rootName}`)
  return { ...p, actual }
}
async function writePath(input) {
  const p = parseVirtualPath(input)
  assertWriteAllowed(p.root)
  const parent = await realpath(dirname(p.candidate)).catch(() => { throw new Error('parent directory does not exist') })
  if (!inside(parent, p.root.real)) throw new Error(`parent resolves outside whitelist root ${p.rootName}`)
  if (existsSync(p.candidate)) {
    const actual = await realpath(p.candidate)
    if (!inside(actual, p.root.real)) throw new Error(`existing path resolves outside whitelist root ${p.rootName}`)
    if ((await stat(actual)).isDirectory()) throw new Error('cannot write a directory')
  }
  return p
}
async function createDirectoriesWithinRoot(input) {
  const p = parseVirtualPath(input)
  assertWriteAllowed(p.root)
  if (p.relativePath === '.') throw new Error('cannot create a whitelist root')
  const parts = p.relativePath.split(sep).filter(Boolean)
  let current = p.root.real
  const createdDirectories = []
  for (const part of parts) {
    const candidate = resolve(current, part)
    if (!inside(candidate, p.root.real)) throw new Error(`path escapes whitelist root ${p.rootName}`)
    try {
      await mkdir(candidate)
      createdDirectories.push(`${p.rootName}/${relative(p.root.real, candidate)}`)
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
    }
    const actual = await realpath(candidate)
    if (!inside(actual, p.root.real)) throw new Error(`symlink resolves outside whitelist root ${p.rootName}`)
    if (!(await stat(actual)).isDirectory()) throw new Error('path exists and is not a directory')
    current = actual
  }
  return { path: p.path, createdDirectories }
}
async function deleteEmptyDirectoryWithinRoot(input) {
  const p = parseVirtualPath(input)
  assertWriteAllowed(p.root)
  if (p.relativePath === '.') throw new Error('cannot delete a whitelist root')
  const parts = p.relativePath.split(sep).filter(Boolean)
  let current = p.root.real
  for (const part of parts) {
    const candidate = resolve(current, part)
    if (!inside(candidate, p.root.real)) throw new Error(`path escapes whitelist root ${p.rootName}`)
    const info = await lstat(candidate)
    if (info.isSymbolicLink()) throw new Error('symlinks are not allowed for directory deletion')
    const actual = await realpath(candidate)
    if (!inside(actual, p.root.real)) throw new Error(`path resolves outside whitelist root ${p.rootName}`)
    if (!info.isDirectory()) throw new Error('path is not a directory')
    current = actual
  }
  try {
    await rmdir(current)
  } catch (e) {
    if (e.code === 'ENOTEMPTY' || e.code === 'EEXIST') throw new Error('directory is not empty')
    throw e
  }
  return p.path
}
function operationEnabled(name) { return ENABLED_OPERATIONS.has(name) }
function assertWriteAllowed(root) {
  if (root.writeAllowed) return
  if (ADVISOR_CONFIG && ADVISOR_CONFIG.caller.level !== 'L2') throw new Error('L2_REQUIRED')
  throw new Error('ROOT_WRITE_DENIED')
}

async function namedDirectory(rootName, path = '.') {
  const root = ROOTS.get(rootName)
  if (!root) throw new Error(`unknown whitelist root: ${rootName}`)
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) throw new Error('path must be relative to the named root')
  const p = await existingPath(path === '.' ? rootName : `${rootName}/${path}`)
  if (!(await stat(p.actual)).isDirectory()) throw new Error('path is not a directory')
  return p
}
function filenameMatcher(pattern) {
  if (typeof pattern !== 'string' || !pattern || pattern.length > 128 || pattern.includes('/') || pattern.includes('\\')) throw new Error('pattern must be a filename glob (max 128 chars, no slash)')
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}
async function walkBounded(start, root, maxDepth, visit, maxEntries = 10_000) {
  let visited = 0
  let stopped = false
  let entryCapHit = false
  async function walk(directory, depth) {
    if (stopped) return
    const handle = await opendir(directory)
    for await (const entry of handle) {
      if (stopped) break
      if (entry.isSymbolicLink() || entry.name === '.git' || entry.name === 'node_modules') continue
      const absolute = resolve(directory, entry.name)
      if (!inside(absolute, root.real)) continue
      visited++
      if (visited > maxEntries) { entryCapHit = true; stopped = true; break }
      if (await visit({ entry, absolute, depth: depth + 1 })) { stopped = true; break }
      if (entry.isDirectory() && depth + 1 < maxDepth) await walk(absolute, depth + 1)
    }
  }
  await walk(start.actual, 0)
  return { visited, stopped, entryCapHit }
}
const GIT_ENV = {
  PATH: '/usr/bin:/bin:/usr/local/bin', HOME: '/nonexistent',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_NO_REPLACE_OBJECTS: '1',
}
async function gitOutput(cwd, args) {
  const baseArgs = ['-c', 'core.fsmonitor=false', '-c', 'core.excludesFile=/dev/null', '-c', 'core.attributesFile=/dev/null', '-c', 'diff.external=', '-c', 'core.pager=cat', '-c', 'log.showSignature=false', '--no-pager']
  return execFile('git', [...baseArgs, ...args], {
    cwd, env: GIT_ENV, timeout: 5000, maxBuffer: 48 * 1024, windowsHide: true,
  })
}
async function gitRepoRoot(directory, whitelistRoot) {
  const { stdout } = await gitOutput(directory, ['rev-parse', '--show-toplevel'])
  const top = await realpath(stdout.trim())
  if (!inside(top, whitelistRoot.real)) throw new Error('Git worktree root resolves outside whitelist root')
  const dotGit = await realpath(resolve(top, '.git')).catch(() => { throw new Error('Git metadata directory is missing') })
  if (!inside(dotGit, whitelistRoot.real) || !(await stat(dotGit)).isDirectory()) throw new Error('only repositories with in-root .git directories are supported')
  for (const entry of ['objects', 'refs', 'config']) {
    const actual = await realpath(resolve(dotGit, entry)).catch(() => { throw new Error(`Git metadata ${entry} is missing`) })
    if (!inside(actual, whitelistRoot.real)) throw new Error(`Git metadata ${entry} resolves outside whitelist root`)
  }
  const config = await readFile(resolve(dotGit, 'config'), 'utf8')
  if (/^\s*\[\s*include(?:if)?(?:\s|\])/im.test(config)) throw new Error('Git config includes are not supported by the read-only tool')
  const alternatesFile = resolve(dotGit, 'objects', 'info', 'alternates')
  if (existsSync(alternatesFile)) {
    const actualAlternates = await realpath(alternatesFile)
    if (!inside(actualAlternates, whitelistRoot.real) || (await readFile(actualAlternates, 'utf8')).trim()) throw new Error('Git object alternates are not supported')
  }
  const indexFile = resolve(dotGit, 'index')
  if (existsSync(indexFile) && !inside(await realpath(indexFile), whitelistRoot.real)) throw new Error('Git index resolves outside whitelist root')
  return top
}

function makeServer() {
  const server = new McpServer(
    { name: 'agent-mcp-advisor', version: '1.3.0' },
    { capabilities: { tools: {} } },
  )
  const registeredOperations = new Set()
  const registerTool = (targetServer, name, config, handler) => {
    if (!operationEnabled(name)) return
    if(FULL_L2 && FILE_DEFAULT_OPERATIONS.includes(name)){const shape={...config.inputSchema};for(const key of ['path','from','to'])if(shape[key]?.describe)shape[key]=shape[key].describe('Absolute Host path or named shortcut path; L2 has full OS-user filesystem access.');config={...config,inputSchema:shape,description:'L2 full OS-user access: '+(config.title||name)+'. Absolute paths are accepted; named roots are shortcuts, not an access whitelist. This operation keeps its documented input/output contract; use host_exec for general native shell operations.'};}
    targetServer.registerTool(name, config, handler)
    registeredOperations.add(name)
  }
  server.registerTool('list_allowed_operations', {
    title: 'List allowed operations',
    description: 'Returns local file whitelist roots and enabled operations. Direct file tools stay path-bounded; optional OpenCode proxy calls enforce the server1 Gateway L2/Host/Container policies.',
    inputSchema: {},
  }, async () => {
    const operations = [...registeredOperations]
    const unregisteredEnabledOperations = [...ENABLED_OPERATIONS].filter(name => !registeredOperations.has(name))
    return text(JSON.stringify({ roots: rootSummary(), operations, unregisteredEnabledOperations, permission_levels:['L1','L2'],l2_mode:FULL_L2?'full-os-user':'legacy-scoped',denied: FULL_L2?[]:['file_tool_arbitrary_shell', 'absolute_paths', 'cross_root_traversal', 'directory_recursive_delete'], gateway_proxy: GATEWAY_PROXY_CONFIG ? { enabled: true, upstream: 'local-gateway-loopback', tools: ACTIVE_GATEWAY_TOOL_NAMES.filter(name => ENABLED_OPERATIONS.has(name)) } : { enabled: false } }, null, 2))
  })

  registerTool(server, 'list_files', {
    title: 'List files',
    description: 'Lists entries below a named whitelist root. Use root/path; with one root, the root prefix may be omitted.',
    inputSchema: { path: z.string().optional().describe('Named root and relative path, for example docs/reports') },
  }, async ({ path }) => {
    try {
      if (!path && ROOTS.size > 1) return text(JSON.stringify([...ROOTS.keys()].map(name => ({ path: `${name}/.`, type: 'directory' })), null, 2))
      const p = await existingPath(path || '.')
      if (!(await stat(p.actual)).isDirectory()) return error('path is not a directory')
      const entries = await readdir(p.actual, { withFileTypes: true })
      return text(JSON.stringify(entries.map(e => ({ path: `${p.rootName}/${p.relativePath === '.' ? '' : `${p.relativePath}/`}${e.name}`, type: e.isDirectory() ? 'directory' : 'file' })), null, 2))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'read_file', {
    title: 'Read file',
    description: 'Reads a UTF-8 file below a named whitelist root.',
    inputSchema: { path: z.string().min(1).describe('Named root and relative file path') },
  }, async ({ path }) => {
    try {
      const p = await existingPath(path)
      const info = await stat(p.actual)
      if (!info.isFile()) return error('path is not a regular file')
      if (info.size > MAX_READ_BYTES) return error(`file exceeds MCP_MAX_READ_BYTES (${MAX_READ_BYTES})`)
      return text(await readFile(p.actual, 'utf8'))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'create_directory', {
    title: 'Create directory',
    description: 'Creates nested directories inside one named whitelist root. Existing directories are an idempotent success; absolute paths and escapes are rejected.',
    inputSchema: { path: z.string().min(1).describe('Named whitelist root plus relative directory path') },
  }, async ({ path }) => {
    try {
      const result = await createDirectoriesWithinRoot(path)
      return text(JSON.stringify({ ok: true, ...result, alreadyExisted: result.createdDirectories.length === 0 }))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'file_info', {
    title: 'File metadata',
    description: 'Returns basic metadata for one existing file or directory inside a named whitelist root; does not read file contents.',
    inputSchema: { path: z.string().min(1).describe('Named root and relative file/directory path') },
  }, async ({ path }) => {
    try {
      const p = await existingPath(path)
      const info = await stat(p.actual)
      return text(JSON.stringify({ path: p.path, type: info.isDirectory() ? 'directory' : info.isFile() ? 'file' : 'other', sizeBytes: info.size, modifiedAt: info.mtime.toISOString(), mode: (info.mode & 0o777).toString(8).padStart(3, '0') }, null, 2))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'search_files', {
    title: 'Search file names',
    description: 'Searches file and directory names using a filename-only glob under one named whitelist root; symlinks are skipped and depth/results are bounded.',
    inputSchema: {
      root: z.string().min(1), path: z.string().optional().describe('Relative starting directory within root; defaults to root'),
      pattern: z.string().min(1).max(128).optional().describe('Filename glob, for example *.md or report-??.csv'),
      max_depth: z.number().int().min(0).max(8).optional(), limit: z.number().int().min(1).max(100).optional(),
    },
  }, async ({ root, path = '.', pattern = '*', max_depth = 4, limit = 50 }) => {
    try {
      const start = await namedDirectory(root, path)
      const matcher = filenameMatcher(pattern)
      const matches = []
      const result = await walkBounded(start, start.root, max_depth, async ({ entry, absolute, depth }) => {
        if (matcher.test(entry.name)) {
          const info = await stat(absolute)
          matches.push({ path: `${start.rootName}/${relative(start.root.real, absolute)}`, type: entry.isDirectory() ? 'directory' : 'file', sizeBytes: info.size })
          return matches.length >= limit
        }
        return false
      })
      return text(JSON.stringify({ matches, entriesVisited: result.visited, entryCapHit: result.entryCapHit, truncated: result.stopped }, null, 2))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'search_text', {
    title: 'Search text files',
    description: 'Searches literal text (not regex) in a bounded set of allowlisted text files under one named root. Symlinks and unsupported/big files are skipped.',
    inputSchema: {
      root: z.string().min(1), path: z.string().optional().describe('Relative starting directory within root; defaults to root'),
      query: z.string().min(1).max(256), case_sensitive: z.boolean().optional(),
      max_depth: z.number().int().min(0).max(8).optional(), limit: z.number().int().min(1).max(50).optional(),
    },
  }, async ({ root, path = '.', query, case_sensitive = false, max_depth = 4, limit = 30 }) => {
    try {
      const start = await namedDirectory(root, path)
      const needle = case_sensitive ? query : query.toLocaleLowerCase()
      const matches = []
      let filesScanned = 0
      let bytesScanned = 0
      let fileCapHit = false
      let byteCapHit = false
      const walk = await walkBounded(start, start.root, max_depth, async ({ entry, absolute }) => {
        if (!entry.isFile() || !SEARCH_TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) return false
        if (filesScanned >= MAX_SEARCH_FILES) { fileCapHit = true; return true }
        filesScanned++
        const info = await stat(absolute)
        if (info.size > MAX_SEARCH_FILE_BYTES) return false
        if (bytesScanned + info.size > MAX_SEARCH_TOTAL_BYTES) { byteCapHit = true; return true }
        bytesScanned += info.size
        const contents = await readFile(absolute, { encoding: 'utf8', flag: fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW })
        const lines = contents.split(String.fromCharCode(10)).map(line => line.endsWith(String.fromCharCode(13)) ? line.slice(0, -1) : line)
        for (let i = 0; i < lines.length; i++) {
          const line = case_sensitive ? lines[i] : lines[i].toLocaleLowerCase()
          const column = line.indexOf(needle)
          if (column !== -1) {
            const sample = lines[i].slice(Math.max(0, column - 80), Math.min(lines[i].length, column + query.length + 160))
            matches.push({ path: `${start.rootName}/${relative(start.root.real, absolute)}`, line: i + 1, text: sample })
            if (matches.length >= limit) return true
          }
        }
        return false
      })
      return text(JSON.stringify({ matches, filesScanned, bytesScanned, fileCapHit, byteCapHit, entryCapHit: walk.entryCapHit, truncated: walk.stopped && !(fileCapHit || byteCapHit) }, null, 2))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'git_summary', {
    title: 'Git read-only summary',
    description: 'Runs only fixed read-only Git summaries inside a whitelisted repository: status, diff-stat, or recent commits. No arbitrary command/arguments, hooks, external diff, or repository outside root.',
    inputSchema: { root: z.string().min(1), path: z.string().optional(), action: z.enum(['status', 'diff_stat', 'recent_commits']), limit: z.number().int().min(1).max(20).optional() },
  }, async ({ root, path = '.', action, limit = 10 }) => {
    try {
      const start = await namedDirectory(root, path)
      const worktree = await gitRepoRoot(start.actual, start.root)
      let args
      if (action === 'status') args = ['status', '--porcelain=v1', '--untracked-files=no', '--ignore-submodules=all', '--no-renames']
      else if (action === 'diff_stat') args = ['diff', '--stat', '--no-ext-diff', '--no-textconv', '--']
      else args = ['log', '-n', String(limit), '--oneline', '--no-decorate', '--no-color', '--no-show-signature']
      const { stdout } = await gitOutput(worktree, args)
      return text(JSON.stringify({ root, path: `${start.rootName}/${relative(start.root.real, worktree) || '.'}`, action, output: stdout.slice(0, 40 * 1024) }, null, 2))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'write_file', {
    title: 'Write file',
    description: 'Writes UTF-8 text below a named whitelist root; parent directories must exist.',
    inputSchema: { path: z.string().min(1).describe('Named root and relative file path'), content: z.string().describe('Complete UTF-8 file content') },
  }, async ({ path, content }) => {
    try {
      const p = await writePath(path)
      await writeFile(p.candidate, content, { encoding: 'utf8', flag: 'w' })
      return text(JSON.stringify({ ok: true, path: p.path, bytes: Buffer.byteLength(content, 'utf8') }))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'delete_file', {
    title: 'Delete file',
    description: 'Deletes one regular file inside a named whitelist root. Directories and roots cannot be deleted.',
    inputSchema: { path: z.string().min(1).describe('Named root and relative file path') },
  }, async ({ path }) => {
    try {
      const p = await existingPath(path)
      assertWriteAllowed(p.root)
      if (p.relativePath === '.') return error('cannot delete a whitelist root')
      if (!(await stat(p.actual)).isFile()) return error('only regular files can be deleted')
      await unlink(p.actual)
      return text(JSON.stringify({ ok: true, deleted: p.path }))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'delete_directory', {
    title: 'Delete empty directory',
    description: 'Deletes one empty subdirectory inside a named whitelist root. Non-empty directories, root directories, and symlinks are rejected; recursive deletion is not supported.',
    inputSchema: { path: z.string().min(1).describe('Named root and relative empty-directory path') },
  }, async ({ path }) => {
    try {
      const deleted = await deleteEmptyDirectoryWithinRoot(path)
      return text(JSON.stringify({ ok: true, deleted }))
    } catch (e) { return error(e.message) }
  })

  registerTool(server, 'rename_file', {
    title: 'Rename file',
    description: 'Renames one regular file to another path inside the same named whitelist root; destination must not exist.',
    inputSchema: { from: z.string().min(1), to: z.string().min(1) },
  }, async ({ from, to }) => {
    try {
      const source = await existingPath(from)
      assertWriteAllowed(source.root)
      const destination = await writePath(to)
      if (source.rootName !== destination.rootName) return error('cross-root rename is not allowed')
      if (source.relativePath === '.' || !(await stat(source.actual)).isFile()) return error('only regular files can be renamed')
      if (existsSync(destination.candidate)) return error('destination already exists')
      await rename(source.actual, destination.candidate)
      return text(JSON.stringify({ ok: true, from: source.path, to: destination.path }))
    } catch (e) { return error(e.message) }
  })
  if (GATEWAY_PROXY_CONFIG) {
    for (const definition of GATEWAY_TOOL_DEFINITIONS) {
      registerTool(server, definition.name, { title: definition.title, description: definition.description, inputSchema: definition.inputSchema }, args => callGatewayTool(GATEWAY_PROXY_CONFIG, definition.name, args))
    }
  }
  const missingRegistrations = [...ENABLED_OPERATIONS].filter(name => !registeredOperations.has(name))
  if (missingRegistrations.length) throw new Error(`enabled operations missing MCP tool registration: ${missingRegistrations.join(', ')}`)
  lastRegisteredOperations = [...registeredOperations]
  return server
}

function authorized(req) {
  const header = req.headers.authorization || ''
  if (header === `Bearer ${TOKEN}`) return true
  return process.env.MCP_ALLOW_UNAUTH_LOCAL === '1'
    && (HOST === '127.0.0.1' || HOST === '::1')
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
}

const httpServer = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, roots: rootSummary(), operations: lastRegisteredOperations, configuredOperations: [...ENABLED_OPERATIONS] }))
    return
  }
  if (req.url?.split('?')[0] !== MCP_PATH) { res.writeHead(404).end('not found'); return }
  if (!authorized(req)) { res.writeHead(401, { 'www-authenticate': 'Bearer' }).end('unauthorized'); return }
  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') { res.writeHead(405).end('method not allowed'); return }
  let server
  try {
    server = makeServer()
  } catch (e) {
    console.error(`MCP tool registry validation failed: ${e.message}`)
    res.writeHead(500, { 'content-type': 'text/plain' }).end('MCP tool registry validation failed')
    return
  }
  const transport = new StreamableHTTPServerTransport({})
  res.on('close', () => { void transport.close(); void server.close() })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res)
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
    if (!res.writableEnded) res.end(String(e))
  }
})

httpServer.listen(PORT, HOST, () => console.error(`agent-mcp-advisor listening on http://${HOST}:${PORT}${MCP_PATH}; roots=${JSON.stringify(rootSummary())}`))
function shutdown() { httpServer.close(() => process.exit(0)) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
