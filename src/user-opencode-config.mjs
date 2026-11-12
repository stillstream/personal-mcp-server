import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parse } from 'jsonc-parser';

export const DEFAULT_OPENCODE_CONFIG = resolve(homedir(), '.config/opencode/opencode.jsonc');
const MAX_BYTES = 1024 * 1024;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function resolveOpenCodeConfigPath(value, base = process.cwd()) {
  if (value === undefined || value === null || value === '') return DEFAULT_OPENCODE_CONFIG;
  if (typeof value !== 'string' || value.includes('\0')) throw Error('USER_OPENCODE_CONFIG_PATH_INVALID');
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return resolve(homedir(), value.slice(2));
  return resolve(base, value);
}

async function readPrivateConfig(path) {
  let handle;
  try {
    if (!isAbsolute(path) || await realpath(path) !== resolve(path)) throw Error();
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 || stat.size > MAX_BYTES) throw Error();
    return await handle.readFile('utf8');
  } catch {
    throw Error('USER_OPENCODE_CONFIG_PRIVATE_REQUIRED');
  } finally {
    if (handle) await handle.close();
  }
}

function validateEndpoint(value) {
  let url;
  try { url = new URL(value); } catch { throw Error('USER_OPENCODE_ENDPOINT_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || ['0.0.0.0', '[::]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw Error('USER_OPENCODE_ENDPOINT_INVALID');
}

export function validateUserOpenCodeConfig(config) {
  if (!object(config)) throw Error('USER_OPENCODE_CONFIG_INVALID');
  if (config.provider !== undefined && !object(config.provider)) throw Error('USER_OPENCODE_PROVIDER_INVALID');
  const providers = config.provider || {};
  for (const [providerID, provider] of Object.entries(providers)) {
    if (!identifier.test(providerID) || !object(provider)) throw Error('USER_OPENCODE_PROVIDER_INVALID');
    if (provider.options !== undefined && !object(provider.options)) throw Error('USER_OPENCODE_PROVIDER_INVALID');
    if (provider.models !== undefined && !object(provider.models)) throw Error('USER_OPENCODE_PROVIDER_INVALID');
    if (provider.options?.baseURL !== undefined) validateEndpoint(provider.options.baseURL);
    if (provider.options?.apiKey !== undefined && (typeof provider.options.apiKey !== 'string' || /[\0\r\n]/.test(provider.options.apiKey))) throw Error('USER_OPENCODE_API_KEY_INVALID');
    for (const [modelID, model] of Object.entries(provider.models || {})) {
      if (!modelID || !object(model) || (model.variants !== undefined && !object(model.variants))) throw Error('USER_OPENCODE_MODEL_INVALID');
    }
  }
  for (const field of ['model', 'small_model']) {
    const value = config[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw Error('USER_OPENCODE_MODEL_SELECTION_INVALID');
    const slash = value.indexOf('/');
    if (slash < 1 || slash === value.length - 1) throw Error('USER_OPENCODE_MODEL_SELECTION_INVALID');
    const providerID = value.slice(0, slash), modelID = value.slice(slash + 1);
    // Built-in OpenCode providers need not be repeated in the user config's provider map.
    if (Object.hasOwn(providers, providerID) && providers[providerID].models && !Object.hasOwn(providers[providerID].models, modelID)) throw Error('USER_OPENCODE_MODEL_SELECTION_INVALID');
  }
  if (!Object.keys(providers).length && typeof config.model !== 'string') throw Error('USER_OPENCODE_MODEL_REQUIRED');
  return config;
}

export async function readUserOpenCodeConfig(path = DEFAULT_OPENCODE_CONFIG) {
  const text = await readPrivateConfig(path);
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) throw Error('USER_OPENCODE_CONFIG_INVALID');
  return validateUserOpenCodeConfig(config);
}

export async function userModelConfig(path = DEFAULT_OPENCODE_CONFIG) {
  const config = await readUserOpenCodeConfig(path);
  return {
    ...(config.provider ? { provider: structuredClone(config.provider) } : {}),
    ...(config.model ? { model: config.model } : {}),
    ...(config.small_model ? { small_model: config.small_model } : {}),
  };
}

export function userConfigDirectory(path = DEFAULT_OPENCODE_CONFIG) {
  return dirname(path);
}
