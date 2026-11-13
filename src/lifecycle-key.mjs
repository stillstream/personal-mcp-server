import { mkdir, lstat, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { loadInstance, readSecret, STATE_ROOT, ensurePrivateDirectory, DEFAULT_CONFIG } from './instance-config.mjs';
export function lifecycleKeyPath(instance, configPath) {
  if (instance.existing_tunnel?.api_key !== undefined) return join(STATE_ROOT, 'credentials', 'tunnel-' + createHash('sha256').update(resolve(configPath)).digest('hex') + '.key');
  return instance.existing_tunnel?.api_key_file || '';
}
// A generated transport credential, never a second human-maintained source.
// Only explicit lifecycle up invokes this; config check/render remains read-only.
export async function materializeTunnelKey(instance, configPath) {
  const key = await readSecret(instance.existing_tunnel, 'api_key', 'api_key_file');
  if (instance.existing_tunnel?.api_key === undefined) return lifecycleKeyPath(instance, configPath);
  for (const dir of [join(project, '.local'), join(STATE_ROOT, 'credentials')]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const s = await lstat(dir);
    if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid() || (s.mode & 0o077)) throw Error('PRIVATE_RUNTIME_DIRECTORY_REQUIRED');
  }
  const path = lifecycleKeyPath(instance, configPath);
  try { const s = await lstat(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.uid !== process.getuid() || (s.mode & 0o077)) throw Error('PRIVATE_RUNTIME_KEY_REQUIRED'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const temporary = path + '.' + randomUUID();
  try { await writeFile(temporary, key, { mode: 0o600, flag: 'wx' }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  return path;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const path = process.argv[2] || process.env.AGENT_MCP_CONFIG || DEFAULT_CONFIG; await materializeTunnelKey(await loadInstance(path), path); }
  catch { console.error('TUNNEL_CREDENTIAL_PREPARATION_FAILED'); process.exitCode = 1; }
}
