#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { loadInstance, readSecret } from '../src/instance-config.mjs';
const [instancePath, output, serverName = 'agent_gateway', callerID = 'dsh'] = process.argv.slice(2);
try {
 if (!output || !isAbsolute(output) || !/^[-A-Za-z0-9_]{1,32}$/.test(serverName)) throw Error('INSTANCE_NEW_ABSOLUTE_OUTPUT_NAMESPACE_REQUIRED');
 const c=await loadInstance(instancePath), caller=c.callers?.find(x=>x.id===callerID);
 if(!caller)throw Error('CALLER_REQUIRED');
 if((await readSecret(caller,'token','token_file')).length<32)throw Error('TOKEN_TOO_SHORT');
 const host=c.listen.host==='::1'?'[::1]':c.listen.host;
 if(!['127.0.0.1','[::1]'].includes(host))throw Error('LOCAL_MCP_URL_REQUIRED');
 const source='JSON.parse(process.getBuiltinModule("fs").readFileSync('+JSON.stringify(c.__configPath)+',"utf8")).callers.find(c=>c.id==='+JSON.stringify(callerID)+')';
 const expression='(()=>{const c='+source+';return "Bearer "+(c.token ?? process.getBuiltinModule("fs").readFileSync('+JSON.stringify(caller.token_file||'')+',"utf8").trim())})()';
 const yaml='# Candidate only; credentials remain in the project instance. Not applied.\n- insert:\n    - id: mcp-agent-gateway\n      name: "@deepseek-ai/dsh-mcp-client"\n      config:\n        serverName: '+serverName+'\n        transport: streamable-http\n        url: '+JSON.stringify('http://'+host+':'+c.listen.port+'/mcp')+'\n        headers:\n          Authorization: !!js '+"'"+expression.replaceAll("'","''")+"'"+'\n        toolCallTimeoutMs: 120000\n        failOnStartupError: false\n';
 await writeFile(output,yaml,{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({candidate:output,applied:false,secrets_written:false}));
} catch(e) {console.error(/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'DSH_CANDIDATE_FAILED');process.exitCode=1;}
