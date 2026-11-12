import test from 'node:test';
import assert from 'node:assert/strict';
import { projectNativeProviders } from '../deploy/native-provider-projection.mjs';

function source() {
  const model = { name: 'Fixture model', tool_call: true, reasoning: true, attachment: true, limit: { context: 262144, output: 8192 }, options: { reasoningEffort: 'low' }, modalities: { input: ['text', 'image'], output: ['text'] }, variants: { low: { reasoningEffort: 'low' }, medium: { reasoningEffort: 'medium' }, high: { reasoningEffort: 'xhigh' } } };
  return { model: 'local-a/model-a', small_model: 'local-b/model-b', provider: { 'local-a': { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:18100/v1', apiKey: 'PRIVATE' }, models: { 'model-a': structuredClone(model) } }, 'local-b': { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://127.0.0.1:18121/v1' }, models: { 'model-b': structuredClone(model) } } } };
}

test('native projection maps provider settings capabilities limits and variants without rewriting endpoints or mutating source', () => {
  const original = source(), before = structuredClone(original), { providers, ledger } = projectNativeProviders(original), p = providers['local-a'], m = p.models['model-a'];
  assert.deepEqual(original, before); assert.equal(p.package, '@opencode/ai/providers/openai-compatible'); assert.equal(p.settings.apiKey, 'PRIVATE');
  assert.equal(p.settings.baseURL, original.provider['local-a'].options.baseURL); assert.deepEqual(m.limit, { context: 262144, output: 8192 });
  assert.deepEqual(m.capabilities, { tools: true, input: ['text', 'image'], output: ['text'], reasoning: { supported: true } });
  assert.deepEqual(m.variants.map(x => [x.id, x.settings.reasoningEffort]), [['low', 'low'], ['medium', 'medium'], ['high', 'xhigh']]);
  assert(!('npm' in p)); assert(!('options' in m)); assert(!ledger.release_ready); assert(!ledger.small_model_runtime_mapping_verified); assert(!ledger.variant_wire_verified);
});

test('unknown source semantics and disabled variant controls fail closed without exposing field values', () => {
  for (const change of [s => s.provider['local-a'].privateUnknown = 'SECRET', s => s.provider['local-a'].models['model-a'].cost = { input: 1, output: 2 }, s => s.provider['local-a'].models['model-a'].limit.unmapped = 1, s => s.provider['local-a'].models['model-a'].unknown = 'SECRET', s => s.provider['local-a'].models['model-a'].variants.low.disabled = true]) {
    const value = source(); change(value); assert.throws(() => projectNativeProviders(value), e => !e.message.includes('SECRET'));
  }
});

test('ledger does not echo credentials and does not infer capability flags or full top-level preservation', () => {
  const { ledger } = projectNativeProviders(source()); assert(!JSON.stringify(ledger).includes('PRIVATE'));
  assert(ledger.legacy_flags.every(x => x.legacy_reasoning_present && x.legacy_attachment_present && !x.capability_flag_semantics_verified));
  assert(ledger.unmapped_top_level_configuration);
});

test('custom providers retain their own user-specified endpoints', () => {
  const value = source(); value.provider.other = { npm: 'other-sdk', options: { baseURL: 'https://example.test/v1' }, models: { custom: { name: 'custom' } } };
  const { providers } = projectNativeProviders(value); assert.equal(providers.other.settings.baseURL, 'https://example.test/v1');
});
