#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mergeInstanceModels } from './merge-opencode.mjs';
import { auditLegacyPreservation } from './audit-config-preservation.mjs';
import { nativeTarget } from '../src/agent-process.mjs';
import { loadInstance, STATE_ROOT, ensurePrivateDirectory } from '../src/instance-config.mjs';
const dockerExec = promisify(execFile);

// prepare writes a fresh owned profile; it never starts an OpenCode service.
// Injectable OS boundaries allow exact consumer verification without Docker/model requests.
export async function prepareContainer({ artifact: a, snapshot = '{}', instance, base = join(STATE_ROOT, 'backends-v2'), exec = dockerExec, verifyTarget = nativeTarget }) {
  if (a.version !== '2.0.32') throw Error('PINNED_V2_REQUIRED');
  if (instance && !instance.containers?.some(c => c.name === a.container)) throw Error('CONTAINER_DENIED');
  const root = a.container_state_root;
  if (!isAbsolute(root || '') || !root.startsWith('/tmp/') || root.includes(String.fromCharCode(0))) throw Error('PRIVATE_CONTAINER_STATE_ROOT_REQUIRED');
  if (!isAbsolute(base)) throw Error('ABSOLUTE_BACKEND_STATE_REQUIRED');
  let original;
  try { original = JSON.parse(snapshot); } catch { throw Error('SNAPSHOT_JSON_INVALID'); }
  if (!instance) throw Error('USER_OPENCODE_INSTANCE_REQUIRED');
  const cfg = await mergeInstanceModels(original, instance, 'container', a.container);
  await verifyTarget(a);
  try { await exec('/usr/bin/docker', ['exec', a.container_id, 'test', '!', '-e', root + '/config/opencode/opencode.json']); }
  catch { throw Error('FRESH_V2_TARGET_REQUIRED_NO_OVERWRITE'); }
  const originalPlugins = cfg.plugin || [];
  cfg.plugin = []; cfg.mcp = { servers: {} }; cfg.permissions = [{ action: '*', resource: '*', effect: 'deny' }];
  delete cfg.permission; cfg.update = 'disable'; delete cfg.autoupdate;
  await ensurePrivateDirectory(STATE_ROOT);
  await ensurePrivateDirectory(base);
  const state = await mkdtemp(join(base, 'container-'));
  await writeFile(join(state, 'original.jsonc'), snapshot, { mode: 0o600, flag: 'wx' });
  const preservation = auditLegacyPreservation(original, cfg);
  const preservationFile = join(state, 'preservation-audit.json');
  await writeFile(preservationFile, JSON.stringify(preservation), { mode: 0o600, flag: 'wx' });
  const candidate = join(state, 'opencode.probe.json');
  await writeFile(candidate, JSON.stringify(cfg, null, 2), { mode: 0o600, flag: 'wx' });
  await exec('/usr/bin/docker', ['exec', a.container_id, 'mkdir', '-m', '700', '-p', ...['home', 'config/opencode', 'data', 'state/opencode', 'cache', 'tmp', 'work'].map(p => root + '/' + p)]);
  await exec('/usr/bin/docker', ['exec', a.container_id, 'chmod', '700', root, ...['home', 'config', 'config/opencode', 'data', 'state', 'state/opencode', 'cache', 'tmp', 'work'].map(p => root + '/' + p)]);
  await exec('/usr/bin/docker', ['cp', candidate, a.container_id + ':' + root + '/config/opencode/opencode.json']);
  await exec('/usr/bin/docker', ['exec', a.container_id, 'chmod', '600', root + '/config/opencode/opencode.json']);
  const models = [];
  for (const [providerID, p] of Object.entries(cfg.provider || {})) for (const [modelID, m] of Object.entries(p.models || {})) models.push({ providerID, modelID, variants: Object.keys(m.variants || {}), endpoint_url: p.options?.baseURL });
  const b = { api_major: 2, version: a.version, container: a.container, container_id: a.container_id, binary: a.container_binary, container_state: root, server_marker: 'agent-mcp-' + randomUUID(), port: 4099, url: 'http://127.0.0.1:4099', registration_container_file: root + '/state/opencode/service.json', connection_file: join(state, 'connection.private.json'), default_model: cfg.model, small_model: cfg.small_model, allowed_models: models, bootstrap_only: true, configuration_preservation_report: preservationFile, full_configuration_preserved: false, native_mapping_verified: false, original_plugins: originalPlugins, plugin_migration: 'pending; bootstrap does not claim plugin compatibility', original_sha256: createHash('sha256').update(snapshot).digest('hex') };
  const path = join(state, 'backend.json');
  await writeFile(path, JSON.stringify(b, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { backend_file: path, backend: b, server_started: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [artifactFile, originalFile = '-', instanceFile] = process.argv.slice(2);
    if (!artifactFile) throw Error('V2_ARTIFACT_REQUIRED');
    const instance = await loadInstance(instanceFile);
    const result = await prepareContainer({ artifact: JSON.parse(await readFile(artifactFile, 'utf8')), snapshot: originalFile === '-' ? '{}' : await readFile(originalFile, 'utf8'), instance });
    console.log(JSON.stringify({ backend_file: result.backend_file, version: result.backend.version, container: result.backend.container, bootstrap_only: true, server_started: false }));
  } catch (e) { console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'CONTAINER_PREPARATION_FAILED'); process.exitCode = 1; }
}
