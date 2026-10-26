#!/usr/bin/env node
// Read-only process inventory. Never reads credential contents or changes a tunnel.
import{readdir,readFile,readlink,stat,writeFile}from'node:fs/promises';import{basename,isAbsolute}from'node:path';
const output=process.argv[2];if(!output||!isAbsolute(output))throw Error('NEW_PRIVATE_ABSOLUTE_OUTPUT_REQUIRED');const entries=[];
function flag(args,key){const i=args.indexOf(key);if(i>=0)return args[i+1];return args.find(x=>x.startsWith(key+'='))?.slice(key.length+1);}
for(const pid of await readdir('/proc')){if(!/^[0-9]+$/.test(pid))continue;try{
 const s=await stat('/proc/'+pid);if(s.uid!==process.getuid())continue;const exe=await readlink('/proc/'+pid+'/exe');if(basename(exe)!=='tunnel-client-runtime-cloudflared')continue;
 const args=(await readFile('/proc/'+pid+'/cmdline','utf8')).split(String.fromCharCode(0));const target=flag(args,'--mcp.server-url')?.replace(/^url=/,'');if(!['http://127.0.0.1:8787/mcp','http://127.0.0.1:18878/mcp'].includes(target))continue;
 const id=flag(args,'--control-plane.tunnel-id'),key=flag(args,'--control-plane.api-key');if(!id)continue;
 entries.push({pid:Number(pid),runtime:exe,existing_tunnel_id:id,current_target:target,key_file:key?.startsWith('file:')?key.slice(5):null,key_source:key?.startsWith('file:')?'existing-file-reference':'not-recorded',health_address:flag(args,'--health.listen-addr')});
}catch{/* Ignore transient or unreadable processes. */}}
await writeFile(output,JSON.stringify({entries,selected_tunnel:null,switch_performed:false},null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({count:entries.length,targets:entries.map(e=>e.current_target),output,note:'Metadata only. No key value read/copied; no tunnel selected, stopped, registered or switched.'}));
