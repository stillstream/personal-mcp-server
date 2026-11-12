import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import { Config } from '@opencode/schema/config';
import { planNativeProfile, nativeModelSelection } from '../deploy/native-profile-plan.mjs';
const large = 'local-a/model-a', small = 'local-b/model-b';
function source() {
  return { $schema: 'https://opencode.ai/config.json', model: large, small_model: small, provider: {
    'local-a': { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:12345/v1', apiKey: 'PRIVATE_KEY' }, models: { 'model-a': { reasoning: true, limit: { context: 262144, output: 8192 } } } },
    'local-b': { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:12346/v1' }, models: { 'model-b': { reasoning: true, attachment: true, limit: { context: 262144, output: 8192 } } } },
  }, compaction: { auto: false }, permission: { skill: 'allow' }, plugin: ['existing-plugin'], mcp: { existing: { type: 'remote', url: 'http://localhost:1234/mcp' } } };
}
test('title-only small-model mapping uses native config model not Session id and does not mutate source', () => {
  const s = source(), copy = structuredClone(s), p = planNativeProfile(s);
  assert.deepEqual(s, copy); assert.deepEqual(p.candidate.model, { providerID: 'local-a', model: 'model-a' });
  assert.deepEqual(p.candidate.agents.title.model, { providerID: 'local-b', model: 'model-b' });
  assert.deepEqual(p.candidate.compaction, { auto: false }); assert(!('small_model' in p.candidate)); assert(!p.ledger.small_model_runtime_verified);
});
test('projected known subset decodes under pinned Native2.0.32 strict schema while id-shaped config rejects', () => {
  const p = planNativeProfile(source()), decode = Schema.decodeUnknownSync(Config.Info, { onExcessProperty: 'error' }), x = decode(p.candidate);
  assert.equal(x.agents.title.model.model, 'model-b'); const bad = structuredClone(p.candidate); bad.agents.title.model = { providerID: 'local-b', id: 'model-b' }; assert.throws(() => decode(bad));
});
test('every top-level field has a row but permission plugin MCP and capability semantics stay blocked', () => {
  const p = planNativeProfile(source()); assert(p.ledger.all_source_top_fields_accounted); assert.equal(p.ledger.rows.length, 8); assert.equal(p.ledger.blocked.length, 5);
  assert(!p.ledger.activation_allowed && !p.ledger.full_configuration_preserved && !p.ledger.release_ready); assert(!JSON.stringify(p.ledger).includes('PRIVATE_KEY'));
  assert(p.candidate.permissions && !p.candidate.plugins && p.candidate.mcp); assert.equal(p.candidate.permissions[0].effect, 'allow'); assert.equal(p.candidate.mcp.servers.existing.codemode, false);
});
test('unknown mixed schema or compaction semantics fail closed without source values', () => {
  for (const f of [s => s.unknown = 'SECRET', s => s.agents = { title: {} }, s => s.compaction.prune = true, s => s.compaction.auto = 'false']) { const s = source(); f(s); assert.throws(() => planNativeProfile(s), e => !e.message.includes('SECRET')); }
});
test('missing external or disabled model is not guessed from legacy reference', () => {
  for (const f of [s => s.small_model = 'missing/other', s => s.model = '', s => s.provider['local-a'].models['model-a'].disabled = true]) { const s = source(); f(s); assert.throws(() => planNativeProfile(s)); }
  assert.deepEqual(nativeModelSelection('p/ns/model', { p: { models: { 'ns/model': {} } } }), { providerID: 'p', model: 'ns/model' });
});
test('optional small model is not invented and source snapshot remains authoritative', () => {
  const s = source(); delete s.small_model; const p = planNativeProfile(s); assert(!p.candidate.agents); assert(!p.ledger.small_model_title_projection_declared); assert.equal(p.ledger.source_top_level_count, 7);
});
