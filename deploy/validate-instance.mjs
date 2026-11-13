#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { loadInstance, DEFAULT_CONFIG, STATE_ROOT } from '../src/instance-config.mjs'
import { validateConfigBoundary, validateContainerBoundaries } from '../src/config-policy.mjs'
import { loadAdvisorConfig } from '../components/advisor-mcp/src/config.mjs'

const [configArg, stateArg] = process.argv.slice(2)
const configPath = configArg || DEFAULT_CONFIG
const installRoot = stateArg || STATE_ROOT
if (!isAbsolute(configPath) || !isAbsolute(installRoot)) throw Error('ABSOLUTE_CONFIG_AND_STATE_REQUIRED')
const configStat = await lstat(configPath)
if (!configStat.isFile() || configStat.isSymbolicLink() || configStat.nlink !== 1 || configStat.uid !== process.getuid() || (configStat.mode & 0o077) !== 0) throw Error('INSTANCE_CONFIG_PRIVATE_REQUIRED')
const config = await loadInstance(configPath)
const protectedPaths = await validateConfigBoundary(config, configPath, installRoot)
await validateContainerBoundaries(config, protectedPaths)
const advisor = await loadAdvisorConfig(configPath)
console.log(JSON.stringify({ status: 'PASS', machine_id: config.machine_id, callers: (config.callers || []).map(x => ({ id: x.id, level: x.level })), host_read_roots: Object.keys(config.host_read_roots || {}), host_write_roots: Object.keys(config.host_write_roots || {}), advisor_roots: [...advisor.roots.keys()], advisor_write_roots: [...advisor.writeRoots], containers: (config.containers || []).map(x => x.name), tunnel_id_configured: !!config.existing_tunnel?.id, tunnel_key_file_configured: !!config.existing_tunnel?.api_key_file }))
