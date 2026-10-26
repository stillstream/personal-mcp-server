import assert from 'node:assert/strict'
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ADVISOR_FILE_OPERATIONS, ADVISOR_GATEWAY_TOOLS, loadAdvisorConfig } from '../src/config.mjs'

async function fixture(level) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-mcp-advisor-config-'))
  await chmod(dir, 0o700)
  const privateDir = join(dir, 'private')
  const root = join(dir, 'root')
  await mkdir(privateDir, { mode: 0o700 })
  await mkdir(root, { mode: 0o700 })
  const tokenFile = join(privateDir, 'chatgpt.token')
  const configPath = join(privateDir, 'instance.json')
  await writeFile(tokenFile, 'unit-test-token-abcdefghijklmnopqrstuvwxyz0123456789\n', { mode: 0o600 })
  await chmod(tokenFile, 0o600)
  const config = {
    machine_id: 'test-local',
    listen: { host: '127.0.0.1', port: 18879 },
    callers: [{ id: 'chatgpt', level, token_file: tokenFile }],
    host_read_roots: {},
    host_write_roots: {},
    containers: [],
    advisor_mcp: {
      enabled: true,
      listen: { host: '127.0.0.1', port: 18787, path: '/mcp' },
      gateway_caller: 'chatgpt',
      roots: { workspace: root },
      write_roots: ['workspace'],
      file_operations: [...ADVISOR_FILE_OPERATIONS],
      gateway_tools: [...ADVISOR_GATEWAY_TOOLS],
    },
    tunnel_client: { enabled: true, binary: 'components/tunnel-client/runtime/test-client', health_addr: '127.0.0.1:18433', target_url: 'http://127.0.0.1:18787/mcp' },
  }
  await writeFile(configPath, JSON.stringify(config) + '\n', { mode: 0o600 })
  await chmod(configPath, 0o600)
  return { dir, configPath, root }
}

test('central config grants L1 reads only and L2 configured writes', async (t) => {
  const l1 = await fixture('L1')
  const l2 = await fixture('L2')
  t.after(async () => { await rm(l1.dir, { recursive: true, force: true }); await rm(l2.dir, { recursive: true, force: true }) })

  const readOnly = await loadAdvisorConfig(l1.configPath)
  assert.equal(readOnly.caller.level, 'L1')
  assert.equal(readOnly.roots.get('workspace').writeAllowed, false)
  assert.equal(readOnly.fileOperations.includes('read_file'), true)
  assert.equal(readOnly.fileOperations.includes('write_file'), false)
  assert.equal(readOnly.gatewayTools.includes('gateway_status'), true)
  assert.equal(readOnly.gatewayTools.includes('opencode_start'), false)
  assert.equal(readOnly.gatewayTools.includes('opencode_status'), true)

  const readWrite = await loadAdvisorConfig(l2.configPath)
  assert.equal(readWrite.caller.level, 'L2')
  assert.equal(readWrite.roots.get('workspace').writeAllowed, true)
  assert.equal(readWrite.fileOperations.includes('write_file'), true)
  assert.equal(readWrite.gatewayTools.includes('opencode_start'), true)
  assert.equal(readWrite.gatewayUrl, 'http://127.0.0.1:18879/mcp')
})

test('central config rejects a non-loopback advisor or tunnel target', async () => {
  const x = await fixture('L2')
  try {
    const cfg = JSON.parse(await (await import('node:fs/promises')).readFile(x.configPath, 'utf8'))
    cfg.advisor_mcp.listen.host = '0.0.0.0'
    await writeFile(x.configPath, JSON.stringify(cfg) + '\n', { mode: 0o600 })
    await chmod(x.configPath, 0o600)
    await assert.rejects(() => loadAdvisorConfig(x.configPath), /ADVISOR_LISTEN_LOOPBACK_REQUIRED/)
  } finally { await rm(x.dir, { recursive: true, force: true }) }
})

test('status-only advisor accepts zero roots but cannot enable filesystem tools',async()=>{
 const x=await fixture('L1');try{
  const cfg=JSON.parse(await (await import('node:fs/promises')).readFile(x.configPath,'utf8'));
  cfg.advisor_mcp.roots={};cfg.advisor_mcp.write_roots=[];cfg.advisor_mcp.file_operations=[];cfg.advisor_mcp.gateway_tools=['gateway_status'];
  await writeFile(x.configPath,JSON.stringify(cfg),{mode:0o600});
  const a=await loadAdvisorConfig(x.configPath);assert.equal(a.roots.size,0);assert.deepEqual(a.fileOperations,[]);assert.deepEqual(a.gatewayTools,['gateway_status']);
  cfg.advisor_mcp.file_operations=['read_file'];await writeFile(x.configPath,JSON.stringify(cfg),{mode:0o600});await assert.rejects(loadAdvisorConfig(x.configPath),/ADVISOR_ROOTS_REQUIRED/);
 }finally{await rm(x.dir,{recursive:true,force:true})}
});
