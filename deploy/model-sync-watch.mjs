#!/usr/bin/env node
import { watch } from 'node:fs';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { DEFAULT_CONFIG, loadInstance, PROJECT_ROOT } from '../src/instance-config.mjs';

export function watchConfigFile(source, onChange, { debounceMs = 700 } = {}) {
  let timer;
  const watcher = watch(dirname(source), { persistent: true }, (_event, filename) => {
    if (filename && filename.toString() !== basename(source)) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void onChange(); }, debounceMs);
  });
  return () => { clearTimeout(timer); watcher.close(); };
}

async function main() {
  const config = await loadInstance(process.env.AGENT_MCP_CONFIG || DEFAULT_CONFIG);
  const manager = fileURLToPath(new URL('./manage.mjs', import.meta.url));
  let running = false, pending = false;
  function sync() {
    if (running) { pending = true; return; }
    running = true;
    process.stdout.write('MODEL_CONFIG_SYNC_STARTED\\n');
    const child = spawn(process.execPath, [manager, 'sync-models'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, AGENT_MCP_CONFIG: process.env.AGENT_MCP_CONFIG || DEFAULT_CONFIG },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '', finished = false;
    const finish = ok => {
      if (finished) return;
      finished = true; running = false;
      if (ok) process.stdout.write('MODEL_CONFIG_SYNC_OK\\n');
      else process.stderr.write('MODEL_CONFIG_SYNC_FAILED ' + (stderr.match(/[A-Z][A-Z0-9_]+/)?.[0] || 'MANAGER_ERROR') + '\\n');
      if (pending) { pending = false; sync(); }
    };
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-2048); });
    child.once('error', () => finish(false));
    child.once('exit', code => finish(code === 0));
  }
  watchConfigFile(config.opencode_config, sync);
  process.stdout.write('MODEL_CONFIG_WATCH_READY\\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
