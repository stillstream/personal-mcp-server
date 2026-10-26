import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, symlink, link, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { promisify } from 'node:util';
import { loadInstance, readSecret, modelConfig, DEFAULT_CONFIG } from '../src/instance-config.mjs';
import { validateConfigBoundary } from '../src/config-policy.mjs';
import { loadAdvisorConfig } from '../components/advisor-mcp/src/config.mjs';
import { loadGatewayClientConfigFromAdvisor } from '../components/advisor-mcp/src/gateway-proxy.mjs';
import { prepareHost } from '../deploy/prepare-host-v2.mjs';
import { prepareContainer } from '../deploy/prepare-opencode-v2.mjs';
const exec = promisify(execFile);
const fakeKey = 'TEST_ONLY_SECRET_MUST_NOT_APPEAR';
const profile = (url, key = fakeKey) => ({ provider: { test: { npm: '@ai-sdk/openai-compatible', options: { baseURL: url, apiKey: key }, models: { fixture: { variants: { medium: {} } } } } }, model: 'test/fixture', small_model: 'test/fixture' });

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-mcp-unified-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'private')); await mkdir(join(dir, 'work')); await mkdir(join(dir, 'install'));
  const file = join(dir, 'private/instance.json');
  const config = { machine_id: 'fixture', listen: { host: '127.0.0.1', port: 18879 }, callers: [{ id: 'frontend', level: 'L2', token: 'f'.repeat(64) }], containers: [{ name: 'fixture-container' }], host_read_roots: { work: '../work' }, host_write_roots: { work: '../work' }, audit: 'audit.jsonl', agents: { state_file: 'state.json', host_scopes_file: 'scopes.json' }, existing_tunnel: { id: 'test-tunnel-id', api_key: fakeKey }, models: { host: profile('http://127.0.0.1:18100/v1'), containers: { 'fixture-container': profile('http://192.0.2.4:18181/v1', fakeKey + '_CONTAINER') } } };
  const save = async () => writeFile(file, JSON.stringify(config), { mode: 0o600 });
  await save(); return { dir, file, config, save };
}

test('init refuses overwrite and DSH candidate keeps token only in central instance', async t => {
  const f=await fixture(t), before=await readFile(f.file,'utf8');
  const cli=new URL('../deploy/project-config.mjs',import.meta.url).pathname;
  await assert.rejects(exec(process.execPath,[cli,'init'],{env:{...process.env,AGENT_MCP_CONFIG:f.file}}),e=>e.code===1&&e.stderr.includes('CONFIG_ALREADY_EXISTS_NO_OVERWRITE')&&!e.stderr.includes(fakeKey));
  assert.equal(await readFile(f.file,'utf8'),before);
  const output=join(f.dir,'private/dsh-candidate.yml');
  await exec(process.execPath,[new URL('../deploy/dsh-config.mjs',import.meta.url).pathname,f.file,output,'test_gateway','frontend']);
  const yaml=await readFile(output,'utf8');
  assert(!yaml.includes(f.config.callers[0].token)); assert(!yaml.includes(fakeKey)); assert(yaml.includes(f.file));
  assert.equal((await stat(output)).mode&0o077,0);
});

test('offline check reports disabled/missing deployment and names invalid container mapping without secrets', async t => {
  const f=await fixture(t), cli=new URL('../deploy/project-config.mjs',import.meta.url).pathname;
  const checked=await exec(process.execPath,[cli,'check'],{env:{...process.env,AGENT_MCP_CONFIG:f.file}});
  const report=JSON.parse(checked.stdout);
  assert.equal(report.runtime_verified,false); assert.equal(report.container_boundary_verified,false);
  for(const code of ['ADVISOR_DISABLED','TUNNEL_DISABLED','TUNNEL_RUNTIME_MISSING']) assert(report.connection_blockers.includes(code));
  assert(!checked.stdout.includes(fakeKey));
  f.config.models.containers.misnamed=f.config.models.containers['fixture-container'];delete f.config.models.containers['fixture-container'];await f.save();
  await assert.rejects(exec(process.execPath,[cli,'check'],{env:{...process.env,AGENT_MCP_CONFIG:f.file}}),e=>e.code===1&&e.stderr.includes('models.containers keys')&&!e.stderr.includes(fakeKey));
});

test('project default is independent of cwd and all paths resolve beside instance', async t => {
  const f = await fixture(t);
  const c = await loadInstance(f.file);
  assert.equal(c.audit, join(f.dir, 'private/audit.jsonl'));
  assert.equal(c.host_read_roots.work, join(f.dir, 'work'));
  assert(DEFAULT_CONFIG.endsWith('/agent-mcp/config/instance.local.json'));
  const module = new URL('../src/instance-config.mjs', import.meta.url).href;
  const code = `import {loadInstance,DEFAULT_CONFIG} from ${JSON.stringify(module)};const c=await loadInstance(process.argv[1]);console.log(JSON.stringify({audit:c.audit,default:DEFAULT_CONFIG}))`;
  const a = await exec(process.execPath, ['--input-type=module', '-e', code, f.file], { cwd: f.dir });
  const b = await exec(process.execPath, ['--input-type=module', '-e', code, f.file], { cwd: '/' });
  assert.equal(a.stdout, b.stdout);
});

test('private instance rejects permissions, symlink and hardlink; malformed JSON does not echo secret', async t => {
  const f = await fixture(t);
  await chmod(f.file, 0o644); await assert.rejects(loadInstance(f.file), /INSTANCE_CONFIG_PRIVATE_REQUIRED/);
  await chmod(f.file, 0o600);
  await symlink(f.file, join(f.dir, 'alias')); await assert.rejects(loadInstance(join(f.dir, 'alias')), /INSTANCE_CONFIG_PRIVATE_REQUIRED/);
  const hard = join(f.dir, 'hard'); await link(f.file, hard); await assert.rejects(loadInstance(f.file), /INSTANCE_CONFIG_PRIVATE_REQUIRED/); await rm(hard);
  await writeFile(f.file, '{"secret":"' + fakeKey + '",broken');
  await assert.rejects(loadInstance(f.file), e => e.message === 'INSTANCE_CONFIG_INVALID' && !String(e).includes(fakeKey));
});

test('inline and file credentials have one explicit source and private files', async t => {
  const f = await fixture(t), path = join(f.dir, 'private/key');
  await writeFile(path, fakeKey, { mode: 0o600 });
  assert.equal(await readSecret({ api_key: fakeKey }, 'api_key', 'api_key_file'), fakeKey);
  await assert.rejects(readSecret({ api_key: fakeKey, api_key_file: path }, 'api_key', 'api_key_file'), /AMBIGUOUS_SECRET_SOURCE/);
  await chmod(path, 0o644); await assert.rejects(readSecret({ api_key_file: path }, 'api_key', 'api_key_file'), /SECRET_FILE_PRIVATE_REQUIRED/); await chmod(path, 0o600);
  await symlink(path, join(f.dir, 'private/alias')); await assert.rejects(readSecret({ api_key_file: join(f.dir, 'private/alias') }, 'api_key', 'api_key_file'));
  await link(path, join(f.dir, 'private/hard')); await assert.rejects(readSecret({ api_key_file: path }, 'api_key', 'api_key_file'));
});

test('relative model key reference is protected for both Gateway and advisor', async t => {
  const f = await fixture(t);
  delete f.config.models.host.provider.test.options.apiKey;
  f.config.models.host.provider.test.options.apiKeyFile = '../work/key';
  await writeFile(join(f.dir, 'work/key'), fakeKey, { mode: 0o600 }); await f.save();
  const c = await loadInstance(f.file);
  assert.equal((await modelConfig(c, 'host')).provider.test.options.apiKey, fakeKey);
  await assert.rejects(validateConfigBoundary(c, f.file, join(f.dir, 'install')), /CONTROL_PLANE_ROOT_OVERLAP/);
  f.config.advisor_mcp = { enabled: true, listen: { host: '127.0.0.1', port: 18787, path: '/mcp' }, gateway_caller: 'frontend', roots: { work: '../work' }, write_roots: [], file_operations: ['read_file'], gateway_tools: ['gateway_status'] };
  await f.save(); await assert.rejects(loadAdvisorConfig(f.file), /CONTROL_PLANE_ROOT_OVERLAP/);
});

test('model endpoints, selections and embedded credential indirection fail closed', async t => {
  const f = await fixture(t);
  for (const url of ['http://user:password@localhost/v1', 'http://localhost/v1?api_key=hidden', 'http://localhost/v1#secret', 'file:///tmp/key', 'http://0.0.0.0/v1']) { f.config.models.host = profile(url); await f.save(); await assert.rejects(loadInstance(f.file), /MODEL_ENDPOINT_INVALID/); }
  f.config.models.host = profile('http://localhost/v1'); f.config.models.host.model = 'test/absent'; await f.save(); await assert.rejects(loadInstance(f.file), /MODEL_SELECTION_INVALID/);
  for (const key of ['bad\nheader', '{env:API_KEY}', '{file:/tmp/key}']) { f.config.models.host = profile('http://localhost/v1', key); await f.save(); await assert.rejects(loadInstance(f.file), /MODEL_API_KEY_INVALID/); }
});

test('actual Host and Container preparations replace stale snapshot model settings from one instance', async t => {
  const f = await fixture(t), c = await loadInstance(f.file), before = JSON.stringify(c);
  const binary = join(f.dir, 'private/opencode'), guard = join(f.dir, 'private/guard');
  await writeFile(binary, 'fixture', { mode: 0o700 }); await writeFile(guard, 'fixture', { mode: 0o700 });
  const snapshot = JSON.stringify({ provider: { stale: { options: { baseURL: 'http://localhost:1/v1', apiKey: 'stale' }, models: { old: {} } } }, model: 'stale/old', plugin: ['legacy-plugin'] });
  const host = await prepareHost({ artifact: { version: '2.0.32', host_binary: binary }, snapshot, gateway: c, gatewayFile: f.file, frontend: 'frontend', guardFile: guard, base: join(f.dir, 'private/host') });
  const h = JSON.parse(await readFile(join(host.backend.root, 'config/opencode/opencode.json'), 'utf8'));
  assert.deepEqual(h.provider, c.models.host.provider); assert.equal(host.backend.default_model, c.models.host.model); assert.equal(h.permissions[0].effect, 'deny'); assert.deepEqual(h.plugin, []); assert.equal(host.server_started, false);
  const commands = []; let copied;
  const container = await prepareContainer({ artifact: { version: '2.0.32', container: 'fixture-container', container_id: 'immutable-test-id', container_binary: '/tmp/opencode', container_state_root: '/tmp/agent-mcp-owned-fixture' }, snapshot, instance: c, base: join(f.dir, 'private/container'), verifyTarget: async () => {}, exec: async (bin, args) => { commands.push(args); if (args[0] === 'cp') copied = JSON.parse(await readFile(args[1], 'utf8')); return { stdout: '', stderr: '' }; } });
  assert.deepEqual(copied.provider, c.models.containers['fixture-container'].provider); assert.equal(container.backend.default_model, copied.model); assert.equal(container.backend.allowed_models[0].router_url, copied.provider.test.options.baseURL); assert(!commands.some(args => args.includes('serve')));
  assert.equal((await stat(container.backend_file)).mode & 0o077, 0); assert.equal(container.server_started, false); assert.equal(JSON.stringify(c), before);
  let touched = false; await assert.rejects(prepareContainer({ artifact: { version: '2.0.32', container: 'outside' }, instance: c, exec: async () => { touched = true; } }), /CONTAINER_DENIED/); assert.equal(touched, false);
});

test('inline single-file Gateway authenticates real MCP calls and rejects L1 writes', async t => {
  const f=await fixture(t), probe=createServer();
  await new Promise(ok=>probe.listen(0,'127.0.0.1',ok)); const port=probe.address().port; await new Promise(ok=>probe.close(ok));
  f.config.listen.port=port; f.config.callers[0].level='L1'; f.config.containers=[]; f.config.models.containers={}; await f.save();
  const child=spawn(process.execPath,[new URL('../src/server.mjs',import.meta.url).pathname],{env:{...process.env,AGENT_MCP_CONFIG:f.file},stdio:['ignore','ignore','pipe']});
  let stderr=''; child.stderr.on('data',b=>stderr+=b);
  const closed=new Promise(ok=>{child.once('close',ok);child.once('error',ok);});
  const client=new Client({name:'inline-config-fixture',version:'1'});
  try {
    const end=Date.now()+4000; while(!stderr.includes('agent-mcp listening')&&child.exitCode===null&&Date.now()<end) await new Promise(ok=>setTimeout(ok,20));
    assert(stderr.includes('agent-mcp listening'),'fixture Gateway did not become ready'); assert(!stderr.includes(fakeKey));
    const url=new URL('http://127.0.0.1:'+port+'/mcp');
    const unauth=await fetch(url,{method:'POST'}); assert.equal(unauth.status,401);
    await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+f.config.callers[0].token}}}));
    const status=await client.callTool({name:'gateway_status',arguments:{}}); assert.equal(JSON.parse(status.content[0].text).result.machine_id,'fixture');
    const write=await client.callTool({name:'host_file',arguments:{action:'write',root:'work',path:'blocked',text:'must-not-write'}}); assert.equal(write.isError,true); assert.equal(JSON.parse(write.content[0].text).code,'L2_REQUIRED');
  } finally { await client.close().catch(()=>{}); child.kill('SIGTERM'); const force=setTimeout(()=>child.kill('SIGKILL'),1000); await closed; clearTimeout(force); }
});

test('advisor proxy consumes inline caller token and applies L1 policy from same instance', async t => {
  const f = await fixture(t); f.config.callers[0].level = 'L1';
  f.config.advisor_mcp = { enabled: true, listen: { host: '127.0.0.1', port: 18787, path: '/mcp' }, gateway_caller: 'frontend', roots: { work: '../work' }, write_roots: ['work'], file_operations: ['read_file', 'write_file'], gateway_tools: ['gateway_status', 'opencode_start', 'opencode_abort'] }; await f.save();
  const advisor = await loadAdvisorConfig(f.file), proxy = await loadGatewayClientConfigFromAdvisor(advisor);
  assert.equal(proxy.token, f.config.callers[0].token); assert.deepEqual(advisor.fileOperations, ['read_file']); assert.deepEqual(advisor.gatewayTools, ['gateway_status']);
});
