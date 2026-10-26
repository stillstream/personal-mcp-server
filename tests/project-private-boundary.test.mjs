import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfigBoundary } from '../src/config-policy.mjs';
import { hostFile, Containers } from '../src/core.mjs';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'agent-mcp-project-boundary-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const repo = join(base, 'agent-mcp'), data = join(base, 'business');
  await mkdir(join(repo, 'config'), { recursive: true });
  await mkdir(join(repo, '.local'));
  await mkdir(data);
  const configPath = join(repo, 'config/instance.local.json');
  const c = { audit: join(repo, '.local/audit.jsonl'), callers: [{ id: 'reader', level: 'L1', token_file: join(repo, '.local/token') }], host_read_roots: { business: data }, host_write_roots: { business: data }, containers: [], existing_tunnel: { api_key_file: join(repo, '.local/key') } };
  await writeFile(configPath, JSON.stringify(c), { mode: 0o600 });
  return { base, repo, data, configPath, c };
}

test('project-local private configuration remains outside all MCP business roots', async t => {
  const f = await fixture(t);
  const protectedPaths = await validateConfigBoundary(f.c, f.configPath, f.repo);
  assert(protectedPaths.includes(f.configPath));
  for (const kind of ['host_read_roots', 'host_write_roots']) {
    for (const root of [f.base, f.repo, join(f.repo, 'config'), join(f.repo, '.local')]) {
      await assert.rejects(validateConfigBoundary({ ...f.c, [kind]: { unsafe: root } }, f.configPath, f.repo), /CONTROL_PLANE_ROOT_OVERLAP/);
    }
  }
});

test('private configuration symlink alias cannot become a business root', async t => {
  const f = await fixture(t), alias = join(f.base, 'alias');
  await symlink(join(f.repo, 'config'), alias);
  await assert.rejects(validateConfigBoundary({ ...f.c, host_read_roots: { unsafe: alias } }, f.configPath, f.repo), /CANONICAL_ROOT_REQUIRED/);
});

test('L1 direct execution still rejects mutations and container launch', async t => {
  const f = await fixture(t), reader = { id: 'reader', level: 'L1' };
  for (const action of ['write', 'edit', 'delete', 'mkdir', 'rename']) {
    await assert.rejects(hostFile(f.c, reader, { action, root: 'business', path: 'sentinel', text: 'must-not-write' }), /L2_REQUIRED/);
  }
  const containers = new Containers(f.c);
  await assert.rejects(containers.start(reader, { container: 'outside' }), /L2_REQUIRED/);
  await assert.rejects(containers.start({ id: 'writer', level: 'L2' }, { container: 'outside' }), /CONTAINER_DENIED/);
});
