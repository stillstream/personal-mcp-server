import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { watchConfigFile } from '../deploy/model-sync-watch.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('user OpenCode watcher observes atomic replacement of the configured file only', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-mcp-model-watch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'opencode.jsonc'), other = join(dir, 'other.jsonc');
  await writeFile(source, '{"model":"p/a"}', { mode: 0o600 });
  let changes = 0; const close = watchConfigFile(source, () => { changes++; }, { debounceMs: 30 }); t.after(close);
  await writeFile(other, '{"model":"p/b"}', { mode: 0o600 }); await delay(100); assert.equal(changes, 0);
  const staged = join(dir, '.opencode.jsonc.tmp'); await writeFile(staged, '{"model":"p/c"}', { mode: 0o600 }); await rename(staged, source);
  await delay(120); assert.equal(changes, 1);
});

test('multiple rapid user config writes are debounced into one sync trigger', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'agent-mcp-model-watch-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'opencode.jsonc'); await writeFile(source, '{}', { mode: 0o600 });
  let changes = 0; const close = watchConfigFile(source, () => { changes++; }, { debounceMs: 50 }); t.after(close);
  await writeFile(source, '{"model":"p/a"}', { mode: 0o600 }); await delay(10);
  await writeFile(source, '{"model":"p/b"}', { mode: 0o600 }); await delay(10);
  await writeFile(source, '{"model":"p/c"}', { mode: 0o600 }); await delay(150);
  assert.equal(changes, 1);
});
