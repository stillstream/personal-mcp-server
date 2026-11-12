import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareHost } from '../deploy/prepare-host-v2.mjs';

async function inputs() {
  const root = await mkdtemp(join(tmpdir(), 'prepare-host-v2-')), binary = join(root, 'opencode'), guard = join(root, 'guard'), source = join(root, 'opencode.jsonc');
  await writeFile(binary, 'synthetic', { mode: 0o700 }); await writeFile(guard, 'synthetic', { mode: 0o700 });
  const config = { model: 'local/fixture', small_model: 'local/fixture', plugin: ['user-plugin'], provider: { local: { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:12345/v1', apiKey: 'test-only' }, models: { fixture: { variants: { low: {}, medium: {}, high: {} } } } } } };
  await writeFile(source, '// shared user config\n' + JSON.stringify(config), { mode: 0o600 });
  return { artifact: { version: '2.0.32', host_binary: binary }, snapshot: JSON.stringify({ model: 'stale/model', provider: { stale: { options: { baseURL: 'http://127.0.0.1:1/v1' }, models: { model: {} } } }, plugin: ['old-plugin'] }), gateway: { opencode_config: source, listen: { host: '127.0.0.1', port: 18879 }, callers: [{ id: 'frontend', level: 'L2' }, { id: 'reader', level: 'L1' }], agents: { host_scopes_file: join(root, 'scopes.json') } }, gatewayFile: join(root, 'gateway.json'), frontend: 'frontend', guardFile: guard, base: join(root, 'profiles'), source, config };
}

test('Host profile preparation projects shared user config into a private caller-bound bootstrap', async () => {
  const i = await inputs(), r = await prepareHost(i), b = r.backend, cfg = JSON.parse(await readFile(join(b.root, 'config/opencode/opencode.json'), 'utf8'));
  assert.equal(r.server_started, false); assert.equal(b.frontend_caller_id, 'frontend'); assert.equal(b.bootstrap_only, true); assert(!('gateway_token_file' in b));
  assert.deepEqual(cfg.mcp, { servers: {} }); assert.equal(cfg.permissions[0].effect, 'deny'); assert.equal(cfg.permissions.length, 9); assert.deepEqual(cfg.plugin, []);
  assert.deepEqual(b.original_plugins, ['old-plugin']); assert.equal(b.default_model, i.config.model); assert.equal(b.allowed_models.length, 1); assert.equal(b.allowed_models[0].endpoint_url, i.config.provider.local.options.baseURL);
  assert.equal(await readFile(join(b.root, 'original.jsonc'), 'utf8'), i.snapshot); assert.equal((await stat(r.backend_file)).mode & 0o077, 0);
});

test('Host preparation rejects forged frontend, unsupported version, missing scopes and non-loopback model endpoints', async () => {
  const i = await inputs();
  await assert.rejects(() => prepareHost({ ...i, frontend: 'reader' }), /HOST_FRONTEND_L2_REQUIRED/);
  await assert.rejects(() => prepareHost({ ...i, artifact: { ...i.artifact, version: '1.19' } }), /PINNED_PRIVATE_HOST_ARTIFACT_REQUIRED/);
  await assert.rejects(() => prepareHost({ ...i, gateway: { ...i.gateway, agents: {} } }), /HOST_TASK_SCOPES_REQUIRED/);
  i.config.provider.local.options.baseURL = 'https://model.example/v1'; await writeFile(i.source, JSON.stringify(i.config), { mode: 0o600 });
  await assert.rejects(() => prepareHost(i), /HOST_PROVIDER_ENDPOINT_DENIED/);
});
