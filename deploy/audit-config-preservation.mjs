#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readUserOpenCodeConfig } from '../src/user-opencode-config.mjs';

const own = (value, key) => value !== null && typeof value === 'object' && Object.hasOwn(value, key);
function subset(source, candidate) {
  if (Array.isArray(source)) return isDeepStrictEqual(source, candidate);
  if (source && typeof source === 'object') {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    return Object.keys(source).every(key => own(candidate, key) && subset(source[key], candidate[key]));
  }
  return isDeepStrictEqual(source, candidate);
}

export function auditLegacyPreservation(original, candidate) {
  const fields = ['$schema', 'model', 'small_model', 'tools', 'skills', 'plugin', 'mcp', 'permission', 'permissions', 'context', 'modalities', 'variants', 'autoupdate'];
  const rows = fields.map(field => ({ field, source_present: own(original, field), candidate_present: own(candidate, field), source_preserved: !own(original, field) ? null : subset(original[field], candidate?.[field]) }));
  const sourceProviders = Object.values(original.provider || {}), candidateProviders = candidate?.provider || {};
  const providers = Object.entries(original.provider || {}).map(([id, provider]) => ({ source_preserved: own(candidateProviders, id) && subset(provider, candidateProviders[id]), model_count: Object.keys(provider.models || {}).length }));
  const contentPreserved = subset(original, candidate);
  return {
    kind: 'user-opencode-source-parity-audit',
    scope: 'user-owned OpenCode source versus isolated Gateway projection; not native-runtime or full-profile acceptance',
    source_provider_count: sourceProviders.length,
    candidate_provider_count: Object.keys(candidate?.provider || candidate?.providers || {}).length,
    source_plugin_count: Array.isArray(original.plugin) ? original.plugin.length : 0,
    candidate_legacy_plugin_count: Array.isArray(candidate?.plugin) ? candidate.plugin.length : 0,
    candidate_native_plugin_count: Array.isArray(candidate?.plugins) ? candidate.plugins.length : 0,
    rows, providers,
    all_source_content_preserved: contentPreserved,
    candidate_uses_legacy_provider_alias: !!candidate?.provider && !candidate?.providers,
    native_v2_shape_declared: !!candidate?.providers && !candidate?.provider,
    native_mapping_verified: false, native_runtime_verified: false,
    external_skill_roots_verified: false, plugin_behaviour_verified: false,
    release_ready: false,
    added_top_level_count: Object.keys(candidate || {}).filter(key => !own(original, key)).length,
    semantic_warning: 'Raw field preservation does not prove Native runtime semantics. Provider/package/settings, MCP, plugin, filesystem skills and behaviour require separate evidence.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    const [sourceFile, candidateFile, output] = process.argv.slice(2);
    if (!sourceFile || !candidateFile || !output || [sourceFile, candidateFile].some(path => resolve(path) === resolve(output))) throw Error('PRIVATE_NEW_REPORT_REQUIRED');
    const original = await readUserOpenCodeConfig(sourceFile);
    const candidate = JSON.parse(await readFile(candidateFile, 'utf8'));
    const report = auditLegacyPreservation(original, candidate);
    await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify(report));
  } catch {
    console.error('PRIVATE_CONFIG_AUDIT_FAILED_NO_VALUES_EMITTED'); process.exitCode = 1;
  }
}
