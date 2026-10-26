import { spawn, execFileSync } from 'node:child_process'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = await mkdtemp(resolve(tmpdir(), 'agent-mcp-advisor-smoke-'))
const token = 'smoke-token'
const testEnv = { ...process.env }
for (const key of Object.keys(testEnv)) if (key.startsWith('MCP_') || key.startsWith('AGENT_MCP_')) delete testEnv[key]
await mkdir(resolve(root, 'docs'), { recursive: true })
await mkdir(resolve(root, 'notes'), { recursive: true })
await symlink(resolve(root, 'notes'), resolve(root, 'docs', 'escape-link'))
await writeFile(resolve(root, 'docs', 'README.md'), 'needle-keyword baseline\\n')
execFileSync('git', ['-C', resolve(root, 'docs'), 'init', '--quiet'])
execFileSync('git', ['-C', resolve(root, 'docs'), 'config', 'user.name', 'MCP Smoke'])
execFileSync('git', ['-C', resolve(root, 'docs'), 'config', 'user.email', 'mcp-smoke@example.invalid'])
execFileSync('git', ['-C', resolve(root, 'docs'), 'add', 'README.md'])
execFileSync('git', ['-C', resolve(root, 'docs'), 'commit', '--quiet', '-m', 'smoke baseline'])
await writeFile(resolve(root, 'docs', 'README.md'), 'needle-keyword baseline\\nmodified\\n')
// Probe an ephemeral test port; a close-to-spawn race fails explicitly rather than reusing a known listener.
const probe = createServer();
await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', ok) });
const port = probe.address().port;
await new Promise(ok => probe.close(ok));
const child = spawn(process.execPath, ['src/server.mjs'], {
  cwd: resolve('.'),
  env: { ...testEnv, MCP_HOST: '127.0.0.1', MCP_ACCESS_TOKEN: token, MCP_PORT: String(port), MCP_ROOTS_JSON: JSON.stringify({ docs: resolve(root, 'docs'), notes: resolve(root, 'notes') }), MCP_ENABLED_OPERATIONS: 'list_files,read_file,write_file,create_directory,file_info,search_files,search_text,git_summary,delete_file,delete_directory,rename_file' },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const exited = new Promise(resolvePromise => child.once('exit', resolvePromise));
let stderr = ''
child.stderr.on('data', chunk => { stderr += chunk })
try {
  await new Promise((resolvePromise, reject) => {
    const deadline = Date.now() + 5000
    const poll = () => {
      if (stderr.includes('listening')) return resolvePromise()
      if (child.exitCode !== null) return reject(new Error(stderr || `server exited before ready: ${child.exitCode}`))
      if (Date.now() > deadline) return reject(new Error(`server timeout: ${stderr}`))
      setTimeout(poll, 25)
    }
    poll()
  })
  const call = (body, auth = token) => new Promise((resolvePromise, reject) => {
    const payload = JSON.stringify(body)
    const req = request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), accept: 'application/json, text/event-stream' } }, res => {
      let data = ''
      res.setEncoding('utf8'); res.on('data', c => { data += c }); res.on('end', () => resolvePromise({ status: res.statusCode, data }))
    })
    req.on('error', reject); req.end(payload)
  })
  const unauthorized = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } }, 'wrong')
  if (unauthorized.status !== 401) throw new Error(`auth guard failed: ${unauthorized.status}`)
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } })
  if (init.status !== 200 || !init.data.includes('agent-mcp-advisor')) throw new Error(`initialize failed: ${init.status} ${init.data}`)
  const mcpJson = body => {
    const line = body.split(String.fromCharCode(10)).find(value => value.startsWith('data: '))
    if (!line) throw new Error(`missing MCP data event: ${body}`)
    return JSON.parse(line.slice(6))
  }
  const listed = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  const listedTools = mcpJson(listed.data).result.tools
  const toolNames = listedTools.map(tool => tool.name)
  for (const name of ['list_allowed_operations', 'list_files', 'read_file', 'write_file', 'create_directory', 'file_info', 'search_files', 'search_text', 'git_summary', 'delete_file', 'delete_directory', 'rename_file']) if (!toolNames.includes(name)) throw new Error(`missing tool ${name}`)
  const createSchema = listedTools.find(tool => tool.name === 'create_directory')?.inputSchema
  if (createSchema?.properties?.path?.type !== 'string') throw new Error(`create_directory path schema missing: ${JSON.stringify(createSchema)}`)
  const declared = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_allowed_operations', arguments: {} } })
  const declaredPayload = JSON.parse(mcpJson(declared.data).result.content[0].text)
  const actualOperationNames = toolNames.filter(name => name !== 'list_allowed_operations').sort()
  if (JSON.stringify([...declaredPayload.operations].sort()) !== JSON.stringify(actualOperationNames)) throw new Error(`capability/tool registry drift: declared=${declaredPayload.operations}; tools=${actualOperationNames}`)
  if (declaredPayload.unregisteredEnabledOperations.length) throw new Error(`unregistered enabled operations: ${declaredPayload.unregisteredEnabledOperations}`)
  const roots = await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_files', arguments: {} } })
  if (!roots.data.includes('docs/.') || !roots.data.includes('notes/.')) throw new Error(`multi-root listing failed: ${roots.data}`)
  const created = await call({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'create_directory', arguments: { path: 'docs/test-parent/test-child' } } })
  if (!created.data.includes('\\"ok\\":true') || !created.data.includes('docs/test-parent/test-child')) throw new Error(`nested directory creation failed: ${created.data}`)
  const parentListing = await call({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'list_files', arguments: { path: 'docs/test-parent' } } })
  if (!parentListing.data.includes('test-child')) throw new Error(`created child missing from list_files: ${parentListing.data}`)
  const markerWrite = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'write_file', arguments: { path: 'docs/test-parent/test-child/keep.txt', content: 'preserve me' } } })
  if (!markerWrite.data.includes('\\"ok\\":true')) throw new Error(`marker write failed: ${markerWrite.data}`)
  const createAgain = await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'create_directory', arguments: { path: 'docs/test-parent/test-child' } } })
  if (!createAgain.data.includes('\\"ok\\":true') || !createAgain.data.includes('\\"alreadyExisted\\":true')) throw new Error(`existing directory should be an idempotent success: ${createAgain.data}`)
  const markerRead = await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'docs/test-parent/test-child/keep.txt' } } })
  if (!markerRead.data.includes('preserve me')) throw new Error(`repeated create changed existing content: ${markerRead.data}`)
  for (const [id, path, expected] of [
    [10, 'docs/../../tmp/test', 'escapes whitelist root docs'],
    [11, 'docs/../notes/outside', 'escapes whitelist root docs'],
    [12, '../../tmp/test', 'path must start with one of'],
    [13, '../outside', 'path must start with one of'],
    [14, '/etc/test', 'absolute paths are not allowed'],
    [15, '/tmp/test', 'absolute paths are not allowed'],
    [16, 'docs/escape-link/subdir', 'symlink resolves outside whitelist root docs'],
  ]) {
    const rejected = await call({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'create_directory', arguments: { path } } })
    if (!mcpJson(rejected.data).result.isError || !rejected.data.includes(expected)) throw new Error(`unsafe create path was not rejected (${path}): ${rejected.data}`)
  }
  const createFilePath = await call({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'create_directory', arguments: { path: 'docs/README.md' } } })
  if (!mcpJson(createFilePath.data).result.isError || !createFilePath.data.includes('path exists and is not a directory')) throw new Error(`create_directory must not alter existing files: ${createFilePath.data}`)
  const deleteSchema = listedTools.find(tool => tool.name === 'delete_directory')?.inputSchema
  if (deleteSchema?.properties?.path?.type !== 'string') throw new Error(`delete_directory path schema missing: ${JSON.stringify(deleteSchema)}`)
  const emptyCreated = await call({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'create_directory', arguments: { path: 'docs/delete-me/nested-empty' } } })
  if (!emptyCreated.data.includes('\\"ok\\":true')) throw new Error(`empty-directory fixture creation failed: ${emptyCreated.data}`)
  const emptyDeleted = await call({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'delete_directory', arguments: { path: 'docs/delete-me/nested-empty' } } })
  if (!emptyDeleted.data.includes('\\"ok\\":true') || !emptyDeleted.data.includes('docs/delete-me/nested-empty')) throw new Error(`empty directory deletion failed: ${emptyDeleted.data}`)
  const afterEmptyDelete = await call({ jsonrpc: '2.0', id: 32, method: 'tools/call', params: { name: 'list_files', arguments: { path: 'docs/delete-me' } } })
  if (afterEmptyDelete.data.includes('nested-empty')) throw new Error(`deleted directory remains visible: ${afterEmptyDelete.data}`)
  const nonemptyDelete = await call({ jsonrpc: '2.0', id: 33, method: 'tools/call', params: { name: 'delete_directory', arguments: { path: 'docs/test-parent' } } })
  if (!mcpJson(nonemptyDelete.data).result.isError || !nonemptyDelete.data.includes('directory is not empty')) throw new Error(`non-empty directory deletion should be rejected: ${nonemptyDelete.data}`)
  const rootDelete = await call({ jsonrpc: '2.0', id: 34, method: 'tools/call', params: { name: 'delete_directory', arguments: { path: 'docs' } } })
  if (!mcpJson(rootDelete.data).result.isError || !rootDelete.data.includes('cannot delete a whitelist root')) throw new Error(`whitelist root deletion should be rejected: ${rootDelete.data}`)
  for (const [id, path, expected] of [
    [35, 'docs/../notes', 'path escapes whitelist root docs'],
    [36, '/tmp/test', 'absolute paths are not allowed'],
    [37, 'docs/escape-link', 'symlinks are not allowed for directory deletion'],
    [38, 'docs/README.md', 'path is not a directory'],
  ]) {
    const rejectedDelete = await call({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'delete_directory', arguments: { path } } })
    if (!mcpJson(rejectedDelete.data).result.isError || !rejectedDelete.data.includes(expected)) throw new Error(`unsafe directory deletion was not rejected (${path}): ${rejectedDelete.data}`)
  }
  const nonemptyStillThere = await call({ jsonrpc: '2.0', id: 39, method: 'tools/call', params: { name: 'list_files', arguments: { path: 'docs/test-parent' } } })
  if (!nonemptyStillThere.data.includes('test-child')) throw new Error(`non-empty directory contents were modified: ${nonemptyStillThere.data}`)
  const info = await call({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'file_info', arguments: { path: 'docs/README.md' } } })
  if (!info.data.includes('sizeBytes') || !info.data.includes('docs/README.md')) throw new Error(`metadata lookup failed: ${info.data}`)
  const searchFiles = await call({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'search_files', arguments: { root: 'docs', pattern: '*.md', max_depth: 2 } } })
  if (!searchFiles.data.includes('docs/README.md')) throw new Error(`filename search failed: ${searchFiles.data}`)
  const searchText = await call({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'search_text', arguments: { root: 'docs', query: 'needle-keyword' } } })
  if (!searchText.data.includes('docs/README.md') || !searchText.data.includes('needle-keyword')) throw new Error(`literal text search failed: ${searchText.data}`)
  const gitStatus = await call({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'git_summary', arguments: { root: 'docs', action: 'status' } } })
  if (!gitStatus.data.includes('README.md')) throw new Error(`git status failed: ${gitStatus.data}`)
  const gitDiff = await call({ jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'git_summary', arguments: { root: 'docs', action: 'diff_stat' } } })
  if (!gitDiff.data.includes('README.md')) throw new Error(`git diff-stat failed: ${gitDiff.data}`)
  const gitLog = await call({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'git_summary', arguments: { root: 'docs', action: 'recent_commits', limit: 5 } } })
  if (!gitLog.data.includes('smoke baseline')) throw new Error(`git log failed: ${gitLog.data}`)
  const wrote = await call({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'write_file', arguments: { path: 'docs/hello.txt', content: 'hello MCP' } } })
  if (!wrote.data.includes('\\"ok\\":true')) throw new Error(`write failed: ${wrote.data}`)
  const read = await call({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'docs/hello.txt' } } })
  if (!read.data.includes('hello MCP')) throw new Error(`read failed: ${read.data}`)
  const renamed = await call({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'rename_file', arguments: { from: 'docs/hello.txt', to: 'docs/renamed.txt' } } })
  if (!renamed.data.includes('\\"ok\\":true')) throw new Error(`rename failed: ${renamed.data}`)
  const deleted = await call({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'delete_file', arguments: { path: 'docs/renamed.txt' } } })
  if (!deleted.data.includes('\\"ok\\":true')) throw new Error(`delete failed: ${deleted.data}`)
  const traversal = await call({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'read_file', arguments: { path: 'docs/../notes/secret.txt' } } })
  if (!traversal.data.includes('escapes whitelist root docs')) throw new Error(`traversal guard failed: ${traversal.data}`)
  console.log('smoke ok: auth, multi-root allowlist, nested create, empty-directory delete, metadata/search/Git, file operations, traversal and symlink guards')
} catch (e) {
  console.error(`smoke failed: ${e.message}\\nserver stderr: ${stderr}`)
  throw e
} finally {
  child.kill('SIGTERM')
  await exited
  await rm(root, { recursive: true, force: true })
}
