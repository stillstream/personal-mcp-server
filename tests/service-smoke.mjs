import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const temp = await mkdtemp(join(tmpdir(), 'agent-mcp-service-manager-'))
const bin = join(temp, 'bin')
const release = join(temp, 'release')
const config = join(temp, 'instance.json')
const log = join(temp, 'calls.log')
await mkdir(bin)
await mkdir(join(release, 'src'), { recursive: true })
await writeFile(join(release, 'src/server.mjs'), '// fake release marker\n')
await writeFile(config, '{"machine_id":"service-test"}\n', { mode: 0o600 })
const systemctlScript = [
  '#!/usr/bin/env bash',
  'case "$*" in',
  '  *"show agent-mcp-shadow.service -p ActiveState --value"*)',
  '    if [ "$(printenv TEST_LEGACY_ACTIVE || true)" = 1 ]; then echo active; else echo not-found; fi',
  '    ;;',
  '  *"show agent-mcp.service -p LoadState --value"*) echo not-found ;;',
  '  *"show agent-mcp.service -p Description --value"*) echo "Agent MCP Gateway local runtime" ;;',
  '  *"show agent-mcp-shadow.service -p Description --value"*) echo "Agent MCP Gateway owned shadow runtime" ;;',
  '  *"stop agent-mcp.service"*|*"stop agent-mcp-shadow.service"*) echo "$*" >> "$TEST_LOG" ;;',
  '  *) echo unexpected-systemctl-call >&2; exit 9 ;;',
  'esac',
].join('\n') + '\n'
const systemdRunScript = ['#!/usr/bin/env bash', 'printf "%s\n" "$*" >> "$TEST_LOG"'].join('\n') + '\n'
await writeFile(join(bin, 'systemctl'), systemctlScript, { mode: 0o700 })
await writeFile(join(bin, 'systemd-run'), systemdRunScript, { mode: 0o700 })
await chmod(join(bin, 'systemctl'), 0o700)
await chmod(join(bin, 'systemd-run'), 0o700)
const env = { ...process.env, PATH: bin + ':' + process.env.PATH, TEST_LOG: log }
function run(...args) {
  return spawnSync('/bin/bash', [join(repo, 'deploy/service.sh'), ...args], { cwd: repo, env, encoding: 'utf8' })
}
try {
  let result = run('start', release, config)
  assert.equal(result.status, 0, result.stderr)
  let calls = await readFile(log, 'utf8')
  assert.match(calls, /--unit=agent-mcp\.service/)
  assert.match(calls, /--description=Agent MCP Gateway local runtime/)
  assert.doesNotMatch(calls, /--unit=agent-mcp-shadow\.service/)

  result = run('stop')
  assert.equal(result.status, 0, result.stderr)
  calls = await readFile(log, 'utf8')
  assert.match(calls, /--user stop agent-mcp\.service/)
  assert.doesNotMatch(calls, /--user stop agent-mcp-shadow\.service/)

  result = run('stop-legacy')
  assert.equal(result.status, 0, result.stderr)
  calls = await readFile(log, 'utf8')
  assert.match(calls, /--user stop agent-mcp-shadow\.service/)

  result = spawnSync('/bin/bash', [join(repo, 'deploy/service.sh'), 'start', release, config], { cwd: repo, env: { ...env, TEST_LEGACY_ACTIVE: '1' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /legacy Gateway still active/)
  console.log(JSON.stringify({ status: 'PASS', canonical_unit: 'agent-mcp.service', legacy_start_blocked: true, no_live_systemd_used: true }))
} finally {
  await rm(temp, { recursive: true, force: true })
}
