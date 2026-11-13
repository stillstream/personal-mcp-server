#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mergeInstanceModels } from './merge-opencode.mjs';
import { loadInstance, STATE_ROOT } from '../src/instance-config.mjs';
import { readUserOpenCodeConfig } from '../src/user-opencode-config.mjs';
import { checkLiveContainerBoundary } from '../src/config-policy.mjs';

const exec = promisify(execFile);
const [gatewayFile, name = 'dlvins-dev', portText = '4097'] = process.argv.slice(2);
if (!gatewayFile || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) throw Error('INSTANCE_AND_REGISTERED_CONTAINER_REQUIRED');
const gateway = await loadInstance(gatewayFile);
if (!gateway.containers.some(c => c.name === name)) throw Error('CONTAINER_DENIED');
const port = Number(portText);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT_INVALID');
const d = JSON.parse((await exec('/usr/bin/docker', ['inspect', '--format', '{{json .}}', name], { timeout: 5000, maxBuffer: 1048576 })).stdout);
await checkLiveContainerBoundary(d, [join(homedir(), '.config/agent-mcp'), join(homedir(), '.local/share/agent-mcp'), STATE_ROOT]);
if (!d.State.Running) throw Error('CONTAINER_NOT_RUNNING');

const source = await readUserOpenCodeConfig(gateway.opencode_config);
const merged = await mergeInstanceModels(source, gateway, 'container', name);
const state = join(STATE_ROOT, 'backends', name + '-' + randomUUID());
await mkdir(state, { recursive: true, mode: 0o700 });
const sourceFile = join(state, 'user-opencode-source.json');
await writeFile(sourceFile, JSON.stringify(source), { mode: 0o600, flag: 'wx' });
const candidate = join(state, 'opencode.json');
await writeFile(candidate, JSON.stringify(merged, null, 2), { mode: 0o600, flag: 'wx' });
const cwd = (await exec('/usr/bin/docker', ['exec', '-w', '/tmp', d.Id, 'mktemp', '-d', '/tmp/agent-mcp-native-XXXXXX'], { timeout: 5000 })).stdout.trim();
if (!/^\/tmp\/agent-mcp-native-[A-Za-z0-9]+$/.test(cwd)) throw Error('INVALID_CONTAINER_STATE_PATH');
await exec('/usr/bin/docker', ['cp', candidate, d.Id + ':' + cwd + '/opencode.json'], { timeout: 10000 });
const password_file = join(state, 'server.password');
await writeFile(password_file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
const allowed_models = [];
for (const [providerID, provider] of Object.entries(merged.provider || {})) {
  for (const [modelID, model] of Object.entries(provider.models || {})) allowed_models.push({ providerID, modelID, variants: Object.keys(model.variants || {}), endpoint_url: provider.options?.baseURL });
}
const backend = { server_marker: 'agent-mcp-' + randomUUID(), container: name, container_id: d.Id, url: 'http://127.0.0.1:' + port, username: 'opencode', password_file, port, container_state: cwd, native_config: cwd + '/opencode.json', default_model: merged.model, small_model: merged.small_model, allowed_models, source_config: gateway.opencode_config, source_sha256: createHash('sha256').update(JSON.stringify(source)).digest('hex') };
const path = join(state, 'backend.json');
await writeFile(path, JSON.stringify(backend, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ backend_file: path, container: name, url: backend.url, default_model: backend.default_model || null, small_model: backend.small_model || null, allowed_model_count: allowed_models.length, source_config: gateway.opencode_config, original_user_config_changed: false, server_started: false }, null, 2));
