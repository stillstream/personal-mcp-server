import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_CONFIG = resolve(PROJECT_ROOT, 'config/instance.local.json');
const MAX_CONFIG_BYTES = 1024 * 1024;
const id = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

async function privateText(path, code) {
  let handle;
  try {
    if (!isAbsolute(path) || await realpath(path) !== resolve(path)) throw Error(code);
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const s = await handle.stat();
    if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o077) !== 0 || s.size > MAX_CONFIG_BYTES) throw Error(code);
    return await handle.readFile('utf8');
  } catch { throw Error(code); }
  finally { if (handle) await handle.close(); }
}

export async function readSecret(record, valueField, fileField) {
  if (!object(record)) throw Error('SECRET_REQUIRED');
  const inline = record[valueField], path = record[fileField];
  if (inline !== undefined && path !== undefined) throw Error('AMBIGUOUS_SECRET_SOURCE');
  let value;
  if (inline !== undefined) { if (typeof inline !== 'string') throw Error('SECRET_INVALID'); value = inline; }
  else if (typeof path === 'string') value = await privateText(path, valueField === 'token' ? 'PRIVATE_TOKEN_REQUIRED' : 'SECRET_FILE_PRIVATE_REQUIRED');
  else throw Error('SECRET_REQUIRED');
  value = value.trim();
  if (!value || /[\0\r\n]/.test(value)) throw Error('SECRET_INVALID');
  return value;
}

function normalizePaths(c, base) {
  const path = v => { if (typeof v !== 'string' || !v || v.includes('\0')) throw Error('CONFIG_PATH_INVALID'); return resolve(base, v); };
  const field = (o, k) => { if (o?.[k] !== undefined) o[k] = path(o[k]); };
  const map = o => { if (o === undefined) return; if (!object(o)) throw Error('CONFIG_PATH_MAP_INVALID'); for (const k of Object.keys(o)) o[k] = path(o[k]); };
  field(c, 'audit');
  for (const caller of c.callers || []) field(caller, 'token_file');
  map(c.host_read_roots); map(c.host_write_roots); map(c.advisor_mcp?.roots);
  field(c.existing_tunnel, 'api_key_file'); field(c.tunnel_client, 'binary');
  if (c.protected_paths !== undefined) { if (!Array.isArray(c.protected_paths)) throw Error('CONFIG_PATH_LIST_INVALID'); c.protected_paths = c.protected_paths.map(path); }
  for (const k of ['state_file', 'host_scopes_file', 'host_backend']) field(c.agents, k);
  map(c.agents?.backends); map(c.agents?.host_backends);
  for (const k of ['guard_file', 'scratch_root']) field(c.host_git, k);
  const profiles = [c.models?.host, ...Object.values(c.models?.containers || {})].filter(Boolean);
  for (const profile of profiles) for (const provider of Object.values(profile.provider || {})) {
    field(provider.options, 'apiKeyFile'); field(provider.options, 'api_key_file');
  }
}

function validateProfile(profile) {
  if (!object(profile) || !object(profile.provider) || !Object.keys(profile.provider).length) throw Error('MODEL_PROFILE_REQUIRED');
  for (const [providerID, p] of Object.entries(profile.provider)) {
    if (!id.test(providerID) || !object(p) || !object(p.options) || !object(p.models) || !Object.keys(p.models).length) throw Error('MODEL_PROVIDER_INVALID');
    let u; try { u = new URL(p.options.baseURL); } catch { throw Error('MODEL_ENDPOINT_INVALID'); }
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname || ['0.0.0.0', '[::]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) throw Error('MODEL_ENDPOINT_INVALID');
    if (p.options.apiKey !== undefined && (typeof p.options.apiKey !== 'string' || /[\0\r\n]/.test(p.options.apiKey) || /^\{(?:env|file):/.test(p.options.apiKey))) throw Error('MODEL_API_KEY_INVALID');
    const refs = [p.options.apiKeyFile, p.options.api_key_file].filter(v => v !== undefined);
    if (refs.length > 1 || refs.length && p.options.apiKey !== undefined) throw Error('AMBIGUOUS_SECRET_SOURCE');
    for (const [modelID, m] of Object.entries(p.models)) if (!modelID || !object(m) || (m.variants !== undefined && !object(m.variants))) throw Error('MODEL_DEFINITION_INVALID');
  }
  for (const key of ['model', 'small_model']) {
    if (key === 'small_model' && profile[key] === undefined) continue;
    const value = profile[key];
    if (typeof value !== 'string') throw Error('MODEL_SELECTION_INVALID');
    const slash = value.indexOf('/'), provider = value.slice(0, slash), model = value.slice(slash + 1);
    if (slash < 1 || !Object.hasOwn(profile.provider, provider) || !Object.hasOwn(profile.provider[provider].models, model)) throw Error('MODEL_SELECTION_INVALID');
  }
}

export async function modelConfig(instance, target, container) {
  const profile = target === 'host' ? instance.models?.host : target === 'container' ? instance.models?.containers?.[container] : undefined;
  if (target === 'container' && !instance.containers?.some(c => c.name === container)) throw Error('CONTAINER_DENIED');
  validateProfile(profile);
  const result = { provider: structuredClone(profile.provider), model: profile.model, ...(profile.small_model ? { small_model: profile.small_model } : {}) };
  for (const p of Object.values(result.provider)) {
    const file = p.options.apiKeyFile || p.options.api_key_file;
    if (file) p.options.apiKey = await readSecret({ apiKeyFile: file }, 'apiKey', 'apiKeyFile');
    else if (p.options.apiKey) p.options.apiKey = await readSecret(p.options, 'apiKey', 'apiKeyFile');
    delete p.options.apiKeyFile; delete p.options.api_key_file;
  }
  return result;
}

export async function loadInstance(configPath = process.env.AGENT_MCP_CONFIG || DEFAULT_CONFIG) {
  const path = resolve(configPath);
  const text = await privateText(path, 'INSTANCE_CONFIG_PRIVATE_REQUIRED');
  let c; try { c = JSON.parse(text); } catch { throw Error('INSTANCE_CONFIG_INVALID'); }
  if (!object(c)) throw Error('INSTANCE_CONFIG_INVALID');
  if(c.permissions!==undefined&&(!object(c.permissions)||c.permissions.l1!=='current'||c.permissions.l2!=='full'))throw Error('PERMISSION_MODEL_INVALID');
  if(c.runtime?.version!==undefined&&c.runtime.version!=='2.1.2')throw Error('RUNTIME_VERSION_MUST_BE_2_1_2');
  if (c.callers !== undefined && !Array.isArray(c.callers)) throw Error('INVALID_POLICY');
  const seen = new Set();
  for (const caller of c.callers || []) {
    if (!object(caller) || typeof caller.id !== 'string' || !id.test(caller.id) || !['L1', 'L2'].includes(caller.level)) throw Error('INVALID_POLICY');
    if (seen.has(caller.id)) throw Error('DUPLICATE_CALLER'); seen.add(caller.id);
    if (caller.token !== undefined && caller.token_file !== undefined) throw Error('AMBIGUOUS_SECRET_SOURCE');
  }
  if (c.containers !== undefined && (!Array.isArray(c.containers) || c.containers.some(x => !object(x) || !id.test(x.name || '')) || new Set(c.containers.map(x => x.name)).size !== c.containers.length)) throw Error('INVALID_CONTAINER_NAME');
  if(c.runtime!==undefined&&!object(c.runtime))throw Error('RUNTIME_SETTINGS_INVALID');
  for(const settings of [c.runtime?.host,...(c.containers||[]).map(x=>x.opencode)].filter(Boolean)){if(!object(settings)||typeof settings.enabled!=='boolean'||!Number.isInteger(settings.port)||settings.port<1024||settings.port>65535||typeof settings.binary!=='string'||!isAbsolute(settings.binary)||settings.binary.includes('\0')||settings.cwd!==undefined&&(typeof settings.cwd!=='string'||!isAbsolute(settings.cwd)))throw Error('RUNTIME_SETTINGS_INVALID');}
  if(c.runtime?.plugins!==undefined&&!Array.isArray(c.runtime.plugins))throw Error('RUNTIME_PLUGINS_ARRAY_REQUIRED');
  for(const settings of [c.runtime?.host,...(c.containers||[]).map(x=>x.opencode)].filter(Boolean))if(settings.max_concurrent!==undefined&&(!Number.isInteger(settings.max_concurrent)||settings.max_concurrent<1||settings.max_concurrent>32))throw Error('SESSION_CONCURRENCY_INVALID');
  const runtimePorts=[c.runtime?.host,...(c.containers||[]).map(x=>x.opencode)].filter(x=>x?.enabled).map(x=>x.port);if(new Set(runtimePorts).size!==runtimePorts.length)throw Error('BACKEND_PORT_ALREADY_CONFIGURED');
  normalizePaths(c, dirname(path));
  if (c.models !== undefined) {
    if (!object(c.models) || (c.models.containers !== undefined && !object(c.models.containers))) throw Error('MODEL_PROFILE_REQUIRED');
    if (c.models.host !== undefined) validateProfile(c.models.host);
    for (const [name, profile] of Object.entries(c.models.containers || {})) { if (!c.containers?.some(x => x.name === name)) throw Error('CONTAINER_DENIED'); validateProfile(profile); }
  }
  Object.defineProperty(c, '__configPath', { value: path });
  return c;
}