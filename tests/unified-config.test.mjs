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
const userConfig = (baseURL = 'http://127.0.0.1:12345/v1', apiKey = fakeKey) => ({
  model: 'test/fixture',
  small_model: 'test/fixture',
  provider: { test: { npm: '@ai-sdk/openai-compatible', name: 'Fixture', options: { baseURL, apiKey }, models: { fixture: { variants: { medium: { reasoningEffort: 'medium' } } } } } },
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'agent-mcp-unified-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'private')); await mkdir(join(dir, 'work')); await mkdir(join(dir, 'install'));
  const file = join(dir, 'private/instance.json');
  const openCodeFile = join(dir, 'private/opencode.jsonc');
  const config = { machine_id: 'fixture', listen: { host: '127.0.0.1', port: 18879 }, callers: [{ id: 'frontend', level: 'L2', token: 'f'.repeat(64) }], containers: [{ name: 'fixture-container' }], host_read_roots: { work: '../work' }, host_write_roots: { work: '../work' }, audit: 'audit.jsonl', agents: { state_file: 'state.json', host_scopes_file: 'scopes.json' }, existing_tunnel: { id: 'test-tunnel-id', api_key: fakeKey }, opencode_config: openCodeFile };
  const save = async () => writeFile(file, JSON.stringify(config), { mode: 0o600 });
  const saveOpenCode = async (value = userConfig()) => writeFile(openCodeFile, '// user-owned OpenCode config\n' + JSON.stringify(value, null, 2).replace(/\n}/g, ',\n}') + '\n', { mode: 0o600 });
  await save(); await saveOpenCode();
  return { dir, file, openCodeFile, config, save, saveOpenCode };
}

test('init refuses overwrite and DSH candidate keeps token only in central instance', async t => {
  const f = await fixture(t), before = await readFile(f.file, 'utf8');
  const cli = new URL('../deploy/project-config.mjs', import.meta.url).pathname;
  await assert.rejects(exec(process.execPath, [cli, 'init'], { env: { ...process.env, AGENT_MCP_CONFIG: f.file } }), e => e.code === 1 && e.stderr.includes('CONFIG_ALREADY_EXISTS_NO_OVERWRITE') && !e.stderr.includes(fakeKey));
  assert.equal(await readFile(f.file, 'utf8'), before);
  const output = join(f.dir, 'private/dsh-candidate.yml');
  await exec(process.execPath, [new URL('../deploy/dsh-config.mjs', import.meta.url).pathname, f.file, output, 'test_gateway', 'frontend']);
  const yaml = await readFile(output, 'utf8');
  assert(!yaml.includes(f.config.callers[0].token)); assert(!yaml.includes(fakeKey)); assert(yaml.includes(f.file));
  assert.equal((await stat(output)).mode & 0o077, 0);
});

test('Host and every registered Container resolve the same user-owned JSONC model source', async t => {
  const f = await fixture(t), c = await loadInstance(f.file);
  const host = await modelConfig(c, 'host');
  const container = await modelConfig(c, 'container', 'fixture-container');
  assert.deepEqual(host, container);
  assert.equal(host.model, 'test/fixture');
  assert.equal(host.provider.test.options.baseURL, 'http://127.0.0.1:12345/v1');
  assert.equal(host.provider.test.options.apiKey, fakeKey);
  const changed = userConfig('http://127.0.0.1:12346/v1', '{env:LOCAL_MODEL_KEY}');
  await f.saveOpenCode(changed);
  assert.deepEqual(await modelConfig(c, 'host'), await modelConfig(c, 'container', 'fixture-container'));
  assert.equal((await modelConfig(c, 'container', 'fixture-container')).provider.test.options.baseURL, 'http://127.0.0.1:12346/v1');
  assert.equal((await modelConfig(c, 'host')).provider.test.options.apiKey, '{env:LOCAL_MODEL_KEY}');
  await assert.rejects(modelConfig(c, 'container', 'not-registered'), /CONTAINER_DENIED/);
});

test('legacy per-target model profiles are rejected instead of silently becoming a second source', async t => {
  const f = await fixture(t); f.config.models = { host: userConfig() }; await f.save();
  await assert.rejects(loadInstance(f.file), /LEGACY_MODEL_PROFILES_REMOVED_USE_USER_OPENCODE_CONFIG/);
});

test('offline check reports deployment blockers and shared model source without exposing secrets', async t => {
  const f = await fixture(t), cli = new URL('../deploy/project-config.mjs', import.meta.url).pathname;
  const checked = await exec(process.execPath, [cli, 'check'], { env: { ...process.env, AGENT_MCP_CONFIG: f.file } });
  const report = JSON.parse(checked.stdout);
  assert.equal(report.runtime_verified, false); assert.equal(report.container_boundary_verified, false);
  for (const code of ['ADVISOR_DISABLED', 'TUNNEL_DISABLED', 'TUNNEL_RUNTIME_MISSING']) assert(report.connection_blockers.includes(code));
  assert.equal(report.model_source, f.openCodeFile);
  assert(!checked.stdout.includes(fakeKey));
});

test('project default is independent of cwd and all paths resolve beside instance', async t => {
  const f = await fixture(t), c = await loadInstance(f.file);
  assert.equal(c.audit, join(f.dir, 'private/audit.jsonl'));
  assert.equal(c.host_read_roots.work, join(f.dir, 'work'));
  assert.equal(c.opencode_config, f.openCodeFile);
  assert(DEFAULT_CONFIG.endsWith('/config/instance.local.json'));
  const module = new URL('../src/instance-config.mjs', import.meta.url).href;
  const code = `import {loadInstance,DEFAULT_CONFIG} from ${JSON.stringify(module)};const c=await loadInstance(process.argv[1]);console.log(JSON.stringify({audit:c.audit,opencode_config:c.opencode_config,default:DEFAULT_CONFIG}))`;
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

test('user OpenCode config must be private, canonical, valid JSONC and safe to project', async t => {
  const f = await fixture(t), c = await loadInstance(f.file);
  await chmod(f.openCodeFile, 0o644); await assert.rejects(modelConfig(c, 'host'), /USER_OPENCODE_CONFIG_PRIVATE_REQUIRED/); await chmod(f.openCodeFile, 0o600);
  await symlink(f.openCodeFile, join(f.dir, 'private/alias.jsonc'));
  f.config.opencode_config = join(f.dir, 'private/alias.jsonc'); await f.save();
  const alias = await loadInstance(f.file); await assert.rejects(modelConfig(alias, 'host'), /USER_OPENCODE_CONFIG_PRIVATE_REQUIRED/);
  f.config.opencode_config = f.openCodeFile; await f.save();
  for (const baseURL of ['http://user:password@localhost/v1', 'http://localhost/v1?api_key=hidden', 'file:///tmp/key', 'http://0.0.0.0/v1']) {
    await f.saveOpenCode(userConfig(baseURL)); const current = await loadInstance(f.file); await assert.rejects(modelConfig(current, 'host'), /USER_OPENCODE_ENDPOINT_INVALID/);
  }
  await f.saveOpenCode(userConfig('http://127.0.0.1:12345/v1', 'bad\nheader'));
  await assert.rejects(modelConfig(await loadInstance(f.file), 'host'), /USER_OPENCODE_API_KEY_INVALID/);
  await writeFile(f.openCodeFile, '{ // malformed\n "model": ' + JSON.stringify(fakeKey) + ', broken', { mode: 0o600 });
  await assert.rejects(modelConfig(await loadInstance(f.file), 'host'), e => e.message === 'USER_OPENCODE_CONFIG_INVALID' && !String(e).includes(fakeKey));
});

test('user OpenCode config path is protected from Gateway writable roots', async t => {
  const f = await fixture(t), c = await loadInstance(f.file);
  f.config.host_write_roots.work = join(f.dir, 'private'); await f.save();
  await assert.rejects(validateConfigBoundary(await loadInstance(f.file), f.file, join(f.dir, 'install')), /CONTROL_PLANE_ROOT_OVERLAP/);
  assert.equal((await readFile(f.openCodeFile, 'utf8')).includes(fakeKey), true);
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

test('actual Host and Container preparations project one source into isolated runtime profiles', async t => {
  const f = await fixture(t), c = await loadInstance(f.file), before = await readFile(f.openCodeFile, 'utf8');
  const binary = join(f.dir, 'private/opencode'), guard = join(f.dir, 'private/guard');
  await writeFile(binary, 'fixture', { mode: 0o700 }); await writeFile(guard, 'fixture', { mode: 0o700 });
  const snapshot = JSON.stringify({ provider: { stale: { options: { baseURL: 'http://localhost:1/v1', apiKey: 'stale' }, models: { old: {} } } }, model: 'stale/old', plugin: ['legacy-plugin'] });
  const host = await prepareHost({ artifact: { version: '2.0.32', host_binary: binary }, snapshot, gateway: c, gatewayFile: f.file, frontend: 'frontend', guardFile: guard, base: join(f.dir, 'private/host') });
  const h = JSON.parse(await readFile(join(host.backend.root, 'config/opencode/opencode.json'), 'utf8'));
  assert.deepEqual(h.provider, c ? (await modelConfig(c, 'host')).provider : {}); assert.equal(host.backend.default_model, 'test/fixture'); assert.equal(h.permissions[0].effect, 'deny'); assert.deepEqual(h.plugin, []); assert.equal(host.server_started, false);
  const commands = []; let copied;
  const container = await prepareContainer({ artifact: { version: '2.0.32', container: 'fixture-container', container_id: 'immutable-test-id', container_binary: '/tmp/opencode', container_state_root: '/tmp/agent-mcp-owned-fixture' }, snapshot, instance: c, base: join(f.dir, 'private/container'), verifyTarget: async () => {}, exec: async (_bin, args) => { commands.push(args); if (args[0] === 'cp') copied = JSON.parse(await readFile(args[1], 'utf8')); return { stdout: '', stderr: '' }; } });
  assert.deepEqual(copied.provider, (await modelConfig(c, 'container', 'fixture-container')).provider); assert.equal(container.backend.default_model, copied.model); assert.equal(container.backend.allowed_models[0].endpoint_url, copied.provider.test.options.baseURL); assert(!commands.some(args => args.includes('serve')));
  assert.equal((await stat(container.backend_file)).mode & 0o077, 0); assert.equal(container.server_started, false); assert.equal(await readFile(f.openCodeFile, 'utf8'), before);
  let touched = false; await assert.rejects(prepareContainer({ artifact: { version: '2.0.32', container: 'outside' }, instance: c, exec: async () => { touched = true; } }), /CONTAINER_DENIED/); assert.equal(touched, false);
});

test('inline single-file Gateway authenticates real MCP calls and rejects L1 writes', async t => {
  const f = await fixture(t), probe = createServer();
  await new Promise(ok => probe.listen(0, '127.0.0.1', ok)); const port = probe.address().port; await new Promise(ok => probe.close(ok));
  f.config.listen.port = port; f.config.callers[0].level = 'L1'; f.config.containers = []; await f.save();
  const child = spawn(process.execPath, [new URL('../src/server.mjs', import.meta.url).pathname], { env: { ...process.env, AGENT_MCP_CONFIG: f.file }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => stderr += b);
  const closed = new Promise(ok => { child.once('close', ok); child.once('error', ok); });
  const client = new Client({ name: 'inline-config-fixture', version: '1' });
  try {
    const end = Date.now() + 4000; while (!stderr.includes('agent-mcp listening') && child.exitCode === null && Date.now() < end) await new Promise(ok => setTimeout(ok, 20));
    assert(stderr.includes('agent-mcp listening'), 'fixture Gateway did not become ready'); assert(!stderr.includes(fakeKey));
    const url = new URL('http://127.0.0.1:' + port + '/mcp');
    const unauth = await fetch(url, { method: 'POST' }); assert.equal(unauth.status, 401);
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer ' + f.config.callers[0].token } } }));
    const status = await client.callTool({ name: 'gateway_status', arguments: {} }); assert.equal(JSON.parse(status.content[0].text).result.machine_id, 'fixture');
    const write = await client.callTool({ name: 'host_file', arguments: { action: 'write', root: 'work', path: 'blocked', text: 'must-not-write' } }); assert.equal(write.isError, true); assert.equal(JSON.parse(write.content[0].text).code, 'L2_REQUIRED');
  } finally { await client.close().catch(() => {}); child.kill('SIGTERM'); const force = setTimeout(() => child.kill('SIGKILL'), 1000); await closed; clearTimeout(force); }
});

test('advisor proxy consumes inline caller token and applies L1 policy from same instance', async t => {
  const f = await fixture(t); f.config.callers[0].level = 'L1';
  f.config.advisor_mcp = { enabled: true, listen: { host: '127.0.0.1', port: 18787, path: '/mcp' }, gateway_caller: 'frontend', roots: { work: '../work' }, write_roots: ['work'], file_operations: ['read_file', 'write_file'], gateway_tools: ['gateway_status', 'opencode_start', 'opencode_abort'] }; await f.save();
  const advisor = await loadAdvisorConfig(f.file), proxy = await loadGatewayClientConfigFromAdvisor(advisor);
  assert.equal(proxy.token, f.config.callers[0].token); assert.deepEqual(advisor.fileOperations, ['read_file']); assert.deepEqual(advisor.gatewayTools, ['gateway_status']);
});
