import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mergeInstanceModels } from '../deploy/merge-opencode.mjs';

const config = { model: 'user-provider/model-a', small_model: 'user-provider/model-small', provider: { 'user-provider': { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:12345/v1', apiKey: '{env:USER_MODEL_KEY}' }, models: { 'model-a': { variants: { low: { reasoningEffort: 'low' } } }, 'model-small': {} } } } };

test('Gateway projects the exact user Provider and model settings without rewriting endpoints', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'provider-config-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'opencode.jsonc'); await writeFile(path, '// user config\n' + JSON.stringify(config), { mode: 0o600 });
  const instance = { opencode_config: path, containers: [{ name: 'container-a' }] };
  const original = { model: 'stale/model', provider: { stale: { models: { model: {} } } }, plugin: ['gateway-isolated-plugin'], mcp: { servers: {} } };
  const before = structuredClone(original), projected = await mergeInstanceModels(original, instance, 'host');
  assert.deepEqual(original, before); assert.deepEqual(projected.provider, config.provider); assert.equal(projected.model, config.model); assert.equal(projected.small_model, config.small_model);
  assert.deepEqual(projected.plugin, original.plugin); assert.deepEqual(projected.mcp, original.mcp);
  assert.equal(projected.provider['user-provider'].options.baseURL, config.provider['user-provider'].options.baseURL);
  const container = await mergeInstanceModels(original, instance, 'container', 'container-a'); assert.deepEqual(container.provider, projected.provider); assert.equal(container.model, projected.model);
  await assert.rejects(mergeInstanceModels(original, instance, 'container', 'not-registered'), /CONTAINER_DENIED/);
  assert.equal(await readFile(path, 'utf8').then(text => text.includes('{env:USER_MODEL_KEY}')), true);
});
