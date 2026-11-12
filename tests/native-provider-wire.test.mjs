import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNativeWireCase, selectNativeWireModels, nativeWireCoverage, assertNativeVisionSelection, assertNativeToolSelection } from './helpers/native-wire-check.mjs';
const expected = { caseID: 'local-a/model-a-high', model: 'model-a', effort: 'xhigh', output: 8192 };
const row = () => ({ case: expected.caseID, model: expected.model, reasoning_effort: 'xhigh', stream: true, upstream_status: 200, sse: true, response_chunks: 1, tools: ['wire_probe'], max_completion_tokens: 8192 });
const models = [{ key: 'local-a/model-a', providerID: 'local-a', id: 'model-a', variants: ['low', 'medium', 'high'] }, { key: 'local-b/model-b', providerID: 'local-b', id: 'model-b', variants: ['low', 'medium', 'high'] }];

test('wire case binds selected user model, reasoning effort and output limit', () => {
  assertNativeWireCase([row()], expected);
  for (const [key, value] of [['case', 'local-b/model-b-high'], ['model', 'different-model'], ['reasoning_effort', 'low'], ['max_completion_tokens', 4096]]) { const r = row(); r[key] = value; assert.throws(() => assertNativeWireCase([r], expected)); }
});

test('provider/model filters are derived from the user config and reject unknown or duplicate keys', () => {
  assert.deepEqual(selectNativeWireModels(models, 'local-b/model-b'), [models[1]]);
  assert.deepEqual(selectNativeWireModels(models), models);
  assert.throws(() => selectNativeWireModels(models, 'missing/model'));
  assert.throws(() => selectNativeWireModels([models[0], models[0]]));
});

test('coverage requires every selected model and each supported effort exactly once', () => {
  const results = models.map(m => ['low', 'medium', 'high'].map(variant => ({ providerID: m.providerID, modelID: m.id, variant, reasoning_effort: variant === 'high' ? 'xhigh' : variant, status: 'PASS' }))).flat();
  assert.equal(nativeWireCoverage(models, models, results).complete_model_wire_verified, true);
  assert.equal(nativeWireCoverage(models, [models[0]], results.slice(0, 3)).complete_model_wire_verified, false);
  assert.throws(() => nativeWireCoverage(models, models, results.slice(1)));
});

test('vision selector uses explicit user modalities and is independent of provider names', () => {
  const model = { key: 'local-a/model-a', providerID: 'local-a', id: 'model-a' }, source = { provider: { 'local-a': { models: { 'model-a': { modalities: { input: ['text', 'image'] } } } } } };
  assert.equal(assertNativeVisionSelection([model], source), model);
  assert.throws(() => assertNativeVisionSelection([], source));
  assert.throws(() => assertNativeVisionSelection([model, model], source));
  assert.throws(() => assertNativeVisionSelection([model], { provider: { 'local-a': { models: { 'model-a': { modalities: { input: ['text'] } } } } } }));
});

function toolSource() { return { model: 'local-a/model-a', provider: { 'local-a': { models: { 'model-a': { tool_call: true } } }, 'local-b': { models: { 'model-b': { tool_call: true } } } } }; }
test('explicit tool selection preserves source default and implicit selection must match it', () => {
  const m = { key: 'local-b/model-b', providerID: 'local-b', id: 'model-b' }, s = toolSource();
  assert.equal(assertNativeToolSelection([m], s), m); assert.equal(s.model, 'local-a/model-a'); assert.throws(() => assertNativeToolSelection([m], s, { implicit: true }));
  const d = { key: 'local-a/model-a', providerID: 'local-a', id: 'model-a' }; assert.equal(assertNativeToolSelection([d], toolSource(), { implicit: true }), d);
});

test('tool selector rejects ambiguity, unsupported tools and vision-combined requests', () => {
  const m = { key: 'local-a/model-a', providerID: 'local-a', id: 'model-a' }, s = toolSource();
  assert.throws(() => assertNativeToolSelection([], s)); assert.throws(() => assertNativeToolSelection([m, m], s)); assert.throws(() => assertNativeToolSelection([m], s, { visionOnly: true }));
  s.provider['local-a'].models['model-a'].tool_call = false; assert.throws(() => assertNativeToolSelection([m], s));
});
