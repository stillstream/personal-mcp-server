#!/usr/bin/env node
// Optional installed-DSH client seam test. Does not attach to or alter the running DSH process.
import{readFile,stat}from'node:fs/promises';import{pathToFileURL}from'node:url';import{randomUUID}from'node:crypto';import assert from'node:assert/strict';
const entry=process.env.DSH_MCP_PLUGIN_ENTRY,clientFile=process.env.AGENT_MCP_CLIENT_CONFIG;if(!entry||!clientFile)throw Error('INSTALLED_DSH_PLUGIN_AND_CLIENT_CONFIG_REQUIRED');
const c=JSON.parse(await readFile(clientFile,'utf8'));const st=await stat(c.token_file);if(st.uid!==process.getuid()||(st.mode&0o077))throw Error('PRIVATE_TOKEN_REQUIRED');const token=(await readFile(c.token_file,'utf8')).trim();const plugin=await import(pathToFileURL(entry));
const registry=new Map(),effects=[];const ctx={root:{},effect(fn){const dispose=fn();if(typeof dispose==='function')effects.push(dispose);},get(){return undefined;},logger:{info(){},warn(){},error(message){console.error(message);}},tools:{register(def){if(registry.has(def.name))throw Error('DUPLICATE_TOOL');registry.set(def.name,def);return()=>registry.delete(def.name);}}};
const serverName='agent_gateway';
async function call(name,args){const def=registry.get('mcp__'+serverName+'__'+name);assert(def,'qualified tool missing');const v=await def.execute(args,{signal:new AbortController().signal});return JSON.parse(v.content[0].text);}
try{
 await plugin.apply(ctx,{serverName,transport:'streamable-http',url:c.url,headers:{Authorization:'Bearer '+token},toolCallTimeoutMs:15000,failOnStartupError:true,reconnect:{enabled:false}});
 const status=await call('gateway_status',{});assert(status.ok);const file='dsh-bridge-'+randomUUID()+'.txt';
 assert((await call('host_file',{action:'write',root:'acceptance',path:file,text:'official bridge synthetic proof'})).ok);
 assert.equal((await call('host_file',{action:'read',root:'acceptance',path:file})).result.text,'official bridge synthetic proof');assert((await call('host_file',{action:'delete',root:'acceptance',path:file})).ok);
 console.log(JSON.stringify({status:'PASS',scope:'official DSH client apply/register/execute/dispose in isolated registry, not live Web/CLI/IM',tools:registry.size,identity:status.result.hostname,uid:status.result.uid}));
}finally{for(const dispose of effects.reverse())await dispose();assert.equal(registry.size,0);}
