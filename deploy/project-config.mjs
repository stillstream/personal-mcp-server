#!/usr/bin/env node
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG, PROJECT_ROOT, STATE_ROOT, ensurePrivateDirectory, loadInstance, readSecret, modelConfig } from '../src/instance-config.mjs';
import { validateConfigBoundary } from '../src/config-policy.mjs';

// No service operations, Docker commands, or network/model calls in this CLI.
const [command, target, container] = process.argv.slice(2);
const configPath = process.env.AGENT_MCP_CONFIG || DEFAULT_CONFIG;
try {
  if (command === 'init') {
    const cfg = JSON.parse(await readFile(join(PROJECT_ROOT, 'config/instance.example.json'), 'utf8'));
    for (const caller of cfg.callers) caller.token = randomBytes(32).toString('hex');
    await ensurePrivateDirectory(dirname(configPath));
    await writeFile(configPath, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ status: 'CREATED_DRAFT', config: configPath, services_started: false, secrets_printed: false }));
  } else if (command === 'check' || command === 'render') {
    const cfg = await loadInstance(configPath);
    if (!cfg.callers?.length) throw Error('CALLERS_REQUIRED');
    if (!['127.0.0.1', '::1'].includes(cfg.listen?.host)) throw Error('LOOPBACK_REQUIRED');
    const tokens = new Set();
    for (const c of cfg.callers) { const token = await readSecret(c, 'token', 'token_file'); if (token.length < 32) throw Error('TOKEN_TOO_SHORT'); if (tokens.has(token)) throw Error('DUPLICATE_CALLER'); tokens.add(token); }
    await validateConfigBoundary(cfg, cfg.__configPath, STATE_ROOT);
    if (cfg.tunnel_client?.enabled) { if (!cfg.existing_tunnel?.id) throw Error('TUNNEL_ID_REQUIRED'); await readSecret(cfg.existing_tunnel, 'api_key', 'api_key_file'); }
    const enabledTargets = [...(cfg.runtime?.host?.enabled ? ['host'] : []), ...(cfg.containers || []).filter(x => x.opencode?.enabled).map(x => x.name)];
    if (enabledTargets.length) await modelConfig(cfg, 'host');
    const requiresEdit = [];
    const walk = (x, path) => { if (!x || typeof x !== 'object') return; for (const [k,v] of Object.entries(x)) { if (typeof v === 'string' && v.includes('REPLACE_WITH')) requiresEdit.push(path + '.' + k); else if (v && typeof v === 'object') walk(v, path + '.' + k); } };
    walk(cfg, 'instance');
    // Configuration validity is not deployment readiness: surface passive blockers
    // without starting services, reading process state, or contacting a provider.
    const connectionBlockers = [];
    if (cfg.advisor_mcp?.enabled !== true) connectionBlockers.push('ADVISOR_DISABLED');
    if (cfg.tunnel_client?.enabled !== true) connectionBlockers.push('TUNNEL_DISABLED');
    if (!Object.keys(cfg.advisor_mcp?.roots || {}).length && cfg.advisor_mcp?.file_operations?.length) connectionBlockers.push('ADVISOR_FILE_ROOTS_NOT_CONFIGURED');
    let runtimePresent = false;
    try { const s = await lstat(cfg.tunnel_client?.binary || ''); runtimePresent = s.isFile() && !s.isSymbolicLink() && !!(s.mode & 0o111); } catch {}
    if (!runtimePresent) connectionBlockers.push('TUNNEL_RUNTIME_MISSING');
    if (command === 'check') console.log(JSON.stringify({ status: requiresEdit.length ? 'DRAFT' : 'PASS', scope: 'offline-configuration-only', requires_edit: requiresEdit, callers: cfg.callers.map(c=>({id:c.id,level:c.level})), model_source: cfg.opencode_config, model_targets: enabledTargets, tunnel_enabled: !!cfg.tunnel_client?.enabled, connection_blockers: connectionBlockers, container_boundary_verified: false, runtime_verified: false }));
    else {
      if (!['host','container'].includes(target)) throw Error('RENDER_TARGET_REQUIRED');
      const model = await modelConfig(cfg, target, container);
      const dir = join(STATE_ROOT, 'rendered');
      await ensurePrivateDirectory(STATE_ROOT);
      await ensurePrivateDirectory(dir);
      const path = join(dir, target + '-' + randomUUID() + '.json');
      await writeFile(path, JSON.stringify(model, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      console.log(JSON.stringify({ status: requiresEdit.length ? 'DRAFT_RENDERED' : 'RENDERED', target, config: path, server_started: false, model_called: false }));
    }
  } else throw Error('USAGE_INIT_CHECK_OR_RENDER_TARGET');
} catch (e) {
  console.error(e.code === 'EEXIST' ? 'CONFIG_ALREADY_EXISTS_NO_OVERWRITE' : e.message === 'CONTAINER_DENIED' ? 'CONTAINER_DENIED: container must be registered in containers[]' : /^[A-Z][A-Z0-9_]+$/.test(e.message) ? e.message : 'CONFIG_OPERATION_FAILED');
  process.exitCode = 1;
}
