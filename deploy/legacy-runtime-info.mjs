#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { lstat, readFile, readlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'

async function captureLegacy() {
  const unit = 'agent-mcp-shadow.service'
  const marker = 'Agent MCP Gateway owned shadow runtime'
  const stateDir = resolve(homedir(), '.local/state/dsh-local-files-mcp')
  const raw = execFileSync('systemctl', ['--user', 'show', unit, '-p', 'ActiveState', '-p', 'Description', '-p', 'ExecStart', '-p', 'Environment', '--no-pager'], { encoding: 'utf8' })
  const property = name => raw.split('\n').find(line => line.startsWith(name + '='))?.slice(name.length + 1) || ''
  if (property('ActiveState') !== 'active' || property('Description') !== marker) throw Error('LEGACY_GATEWAY_NOT_OWNED_OR_ACTIVE')
  const argvText = property('ExecStart').split('argv[]=')[1]?.split(';')[0] || ''
  const argv = argvText.trim().split(/\s+/)
  const entry = argv.find(value => value.endsWith('/src/server.mjs'))
  if (!entry) throw Error('LEGACY_GATEWAY_ENTRY_NOT_FOUND')
  const release = resolve(dirname(dirname(entry)))
  const environment = property('Environment').trim().split(/\s+/)
  const configItem = environment.find(value => value.startsWith('AGENT_MCP_CONFIG='))
  const config = configItem?.slice('AGENT_MCP_CONFIG='.length) || ''
  if (!isAbsolute(config)) throw Error('LEGACY_GATEWAY_CONFIG_NOT_FOUND')
  await lstat(config)
  const pid = Number((await readFile(resolve(stateDir, 'mcp.pid'), 'utf8')).trim())
  if (!Number.isSafeInteger(pid) || pid < 2) throw Error('LEGACY_ADVISOR_PID_INVALID')
  const advisorDir = await readlink('/proc/' + pid + '/cwd')
  if (!advisorDir.endsWith('/mcp-file-server')) throw Error('LEGACY_ADVISOR_DIR_NOT_FOUND')
  await lstat(resolve(advisorDir, 'start-openai-tunnel.sh'))
  return { release, config, advisorDir, stateDir }
}

async function loadManifest(path) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  return { release: value.legacy_release, config: value.legacy_config, advisorDir: value.legacy_advisor_dir, stateDir: value.legacy_state_dir }
}

const args = process.argv.slice(2)
const info = args[0] === '--manifest' ? await loadManifest(args[1]) : await captureLegacy()
if (args.includes('--nul')) {
  const values = [info.release, info.config, info.advisorDir, info.stateDir]
  process.stdout.write(values.join(String.fromCharCode(0)) + String.fromCharCode(0))
} else {
  console.log(JSON.stringify(info))
}
