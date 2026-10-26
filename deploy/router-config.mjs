#!/usr/bin/env node
import{isIP}from'node:net';import{readFile,writeFile}from'node:fs/promises';import{isAbsolute,resolve}from'node:path';
const ids=new Set(['Qwen3.8-27B-NVFP4-RTX5090','qwen3.8-flash-next-local']);
export function renderRouter(c){
 if(!Array.isArray(c.models)||c.models.length!==2||new Set(c.models.map(x=>x.id)).size!==2||c.models.some(m=>!ids.has(m.id)))throw Error('TWO_EXISTING_MODEL_IDS_REQUIRED');
 if(!isAbsolute(c.stats_socket)||c.stats_socket.length>100||/[\s\n]/.test(c.stats_socket))throw Error('PRIVATE_STATS_SOCKET_REQUIRED');
 const ports=new Set(),names=new Set();const lines=['global','    log stdout format raw local0 info','    maxconn 256','    nbthread 2','    stats socket '+c.stats_socket+' mode 600 level user','    stats timeout 5s','','defaults','    mode http','    log global','    option dontlog-normal','    timeout connect 2s','    timeout client 15m','    timeout server 15m','    timeout http-request 10s','    timeout check 2s','    retries 0',''];
 for(const m of c.models){
  if(!/^[A-Za-z][A-Za-z0-9_]{0,24}$/.test(m.name)||names.has(m.name))throw Error('UNIQUE_BACKEND_NAME_REQUIRED');names.add(m.name);
  if(!Number.isInteger(m.listen_port)||m.listen_port<1024||m.listen_port>65535||ports.has(m.listen_port))throw Error('UNIQUE_USER_PORT_REQUIRED');ports.add(m.listen_port);
  const modes=m.routes?.map(x=>x.mode).join(',');if(!['LAN,Tailscale','local,LAN,Tailscale'].includes(modes))throw Error('ROUTE_PRIORITY_REQUIRED');
  lines.push('frontend fe_'+m.name,'    bind 127.0.0.1:'+m.listen_port,'    http-request return status 503 content-type application/json string '+JSON.stringify(JSON.stringify({error:{code:'MODEL_NETWORK_UNAVAILABLE',model:m.id}}))+ ' if { nbsrv(bk_'+m.name+') lt 1 }','    default_backend bk_'+m.name,'','backend bk_'+m.name,'    balance first','    option httpchk GET /health','    http-check expect status 200','    option log-health-checks');
  for(const [i,r]of m.routes.entries()){
   const u=new URL(r.url);if(u.protocol!=='http:'||isIP(u.hostname)!==4||u.username||u.password||u.pathname!=='/'||u.search||u.hash||!u.port)throw Error('EXPLICIT_HTTP_IPV4_ROUTE_REQUIRED');
   lines.push('    server '+r.mode+' '+u.hostname+':'+u.port+' check inter 1s fall 2 rise 2'+(i===0?'':' backup'));
  }
  lines.push('');
 }
 return lines.join('\n');
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('INSTANCE_AND_NEW_CONFIG_REQUIRED');const c=JSON.parse(await readFile(input,'utf8'));await writeFile(output,renderRouter(c),{mode:0o600,flag:'wx'});console.log('HAProxy config prepared; no listener or upstream service changed.');
}
