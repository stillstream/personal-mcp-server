import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, sep } from 'node:path';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PROJECT_ROOT, CONFIG_ROOT, STATE_ROOT, DEFAULT_CONFIG, ensurePrivateDirectory } from '../src/instance-config.mjs';
import { runtimeDirectory } from '../src/runtime-client.mjs';

const within = (child, parent) => { const r = relative(parent, child); return r === '' || (!r.startsWith('..' + sep) && r !== '..' && !isAbsolute(r)); };

test('source, private configuration and mutable runtime state use separate XDG locations', () => {
  assert.equal(PROJECT_ROOT, fileURLToPath(new URL('../', import.meta.url)));
  assert.equal(CONFIG_ROOT, homedir() + '/.config/agent-mcp');
  assert.equal(DEFAULT_CONFIG, CONFIG_ROOT + '/instance.amd64.json');
  assert.equal(STATE_ROOT, homedir() + '/.local/state/agent-mcp');
  for (const path of [STATE_ROOT, runtimeDirectory('host'), runtimeDirectory('container', 'dlvins-dev')]) assert(!within(path, PROJECT_ROOT));
  assert(within(runtimeDirectory('host'), STATE_ROOT));
  assert(within(runtimeDirectory('container', 'dlvins-dev'), STATE_ROOT));
});

test('private state directory helper rejects an existing permissive directory', async t => {
  const root = await mkdtemp(joinPath(tmpdir(), 'agent-mcp-private-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o755);
  await assert.rejects(ensurePrivateDirectory(root), /PRIVATE_RUNTIME_DIRECTORY_REQUIRED/);
});

function joinPath(a, b) { return a.replace(/\/$/, '') + '/' + b; }
