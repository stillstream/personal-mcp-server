import { fileURLToPath } from 'node:url'
import { dirname, isAbsolute, resolve } from 'node:path'
import { loadAdvisorConfig } from './config.mjs'
import { lifecycleKeyPath } from '../../../src/lifecycle-key.mjs'

const instancePath = process.argv[2] || process.env.AGENT_MCP_CONFIG
const runtime = await loadAdvisorConfig(instancePath)
const instance = runtime.instance
const tunnel = instance.tunnel_client || {}
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const binaryValue = tunnel.binary || 'components/tunnel-client/runtime/tunnel-client-runtime-cloudflared'
const tunnelBinary = isAbsolute(binaryValue) ? binaryValue : resolve(repoRoot, binaryValue)
const values = [
  runtime.listen.host,
  String(runtime.listen.port),
  runtime.listen.path,
  tunnel.health_addr || '127.0.0.1:38433',
  tunnelBinary,
  instance.existing_tunnel?.id || '',
  lifecycleKeyPath(instance, runtime.configPath),
  JSON.stringify(Object.fromEntries([...runtime.roots].map(([name, root]) => [name, root.configured]))),
  [...runtime.enabledOperations].join(','),
  runtime.gatewayUrl,
  instance.machine_id || '',
  instance.listen.host,
  String(instance.listen.port),
]
process.stdout.write(values.map(value => String(value).replaceAll(String.fromCharCode(0), '')).join(String.fromCharCode(0)) + String.fromCharCode(0))
