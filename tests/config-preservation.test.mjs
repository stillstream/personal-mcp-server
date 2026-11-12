import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLegacyPreservation } from '../deploy/audit-config-preservation.mjs';

function source() {
  return { $schema: 'private-schema', model: 'local/model-a', small_model: 'local/model-small', plugin: ['user-plugin'], skills: ['private-skill-root'], mcp: { existing: { token: 'SECRET_DO_NOT_PRINT' } }, permission: { '*': 'ask' }, tools: { read: false }, custom: 'PRIVATE_UNKNOWN_VALUE', provider: { local: { npm: '@ai-sdk/openai-compatible', options: { apiKey: 'SECRET_DO_NOT_PRINT', baseURL: 'http://127.0.0.1:12345/v1' }, models: { 'model-a': { variants: { high: { reasoningEffort: 'xhigh' } } } } } } };
}

test('unchanged user OpenCode config is preserved without network endpoint rewriting', () => {
  const a = source(), b = structuredClone(a), report = auditLegacyPreservation(a, b);
  assert(report.all_source_content_preserved); assert(report.providers.every(p => p.source_preserved));
  assert(!report.release_ready); assert(!report.native_runtime_verified); assert.equal(b.provider.local.options.baseURL, a.provider.local.options.baseURL);
});

test('Gateway security projection stripping plugins, MCP and permissions is explicitly visible', () => {
  const a = source(), b = structuredClone(a); b.plugin = []; b.mcp = { servers: {} }; b.permissions = [{ action: '*', effect: 'deny' }]; delete b.permission; delete b.skills;
  const report = auditLegacyPreservation(a, b);
  assert(!report.all_source_content_preserved);
  for (const field of ['plugin', 'mcp', 'permission', 'skills']) assert.equal(report.rows.find(x => x.field === field).source_preserved, false);
});

test('provider variants credentials unknown keys and defaults cannot disappear silently', () => {
  for (const change of [b => delete b.provider.local, b => b.provider.local.models['model-a'].variants = {}, b => b.model = 'changed/model', b => delete b.small_model, b => delete b.custom, b => b.provider.local.options.apiKey = 'changed']) {
    const a = source(), b = structuredClone(a); change(b); assert(!auditLegacyPreservation(a, b).all_source_content_preserved);
  }
});

test('report emits no source values, provider identifiers or credential material', () => {
  const a = source(), report = JSON.stringify(auditLegacyPreservation(a, structuredClone(a)));
  for (const secret of ['SECRET_DO_NOT_PRINT', 'PRIVATE_UNKNOWN_VALUE', 'private-skill-root', 'private-schema', 'local']) assert(!report.includes(secret));
});

test('new providers do not count as source loss; native shape still requires explicit mapping', () => {
  const a = source(), b = structuredClone(a); b.provider.extra = {};
  assert(auditLegacyPreservation(a, b).all_source_content_preserved);
  const native = { providers: b.provider, plugins: a.plugin, model: a.model };
  const report = auditLegacyPreservation(a, native);
  assert(report.native_v2_shape_declared); assert(!report.native_mapping_verified); assert(!report.all_source_content_preserved); assert(!report.release_ready);
});
