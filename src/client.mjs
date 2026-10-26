#!/usr/bin/env node
import {readFile,stat} from 'node:fs/promises';
import {loadInstance,readSecret} from './instance-config.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
// Credentials are referenced by file, never accepted on the command line or printed.
const instance=await loadInstance();const caller=instance.callers?.find(c=>c.id===(process.env.AGENT_MCP_CALLER||'dsh'));if(!caller)throw Error('CALLER_REQUIRED');
const config=caller;const url=new URL('http://'+(instance.listen.host==='::1'?'[::1]':instance.listen.host)+':'+instance.listen.port+'/mcp');
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.protocol!=='http:')throw Error('LOOPBACK_REQUIRED');
const token=await readSecret(config,'token','token_file');
const client=new Client({name:'agent-mcp-reference-client',version:'1.3.0'});
try{
 await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}}));
 if(process.argv[2]==='schema')console.log(JSON.stringify(await client.listTools(),null,2));
 else{const name=process.argv[2];if(!name)throw Error('TOOL_NAME_REQUIRED');const chunks=[];for await(const b of process.stdin)chunks.push(b);const args=JSON.parse(Buffer.concat(chunks).toString()||'{}');const r=await client.callTool({name,arguments:args});console.log(JSON.stringify(r,null,2));if(r.isError)process.exitCode=1;}
}finally{await client.close();}
