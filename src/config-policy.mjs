import {realpath,lstat,readFile}from'node:fs/promises';import{execFile}from'node:child_process';import{promisify}from'node:util';
const exec=promisify(execFile);import{resolve,relative,isAbsolute,dirname,basename}from'node:path';
import{credentialReferencePaths}from'./credential-environment.mjs';const within=(child,parent)=>{const r=relative(parent,child);return r===''||(!r.startsWith('../')&&r!=='..'&&!isAbsolute(r));};
const LOOPBACK_HOSTS=new Set(['127.0.0.1','localhost','[::1]']);
const ADVISOR_FILE_OPS=new Set(['list_files','read_file','write_file','create_directory','file_info','search_files','search_text','git_summary','delete_file','delete_directory','rename_file']);
const ADVISOR_GATEWAY_TOOLS=new Set(['gateway_status','opencode_start','opencode_continue','opencode_status','opencode_diff','opencode_abort','host_exec','host_poll','host_stop','container_list','container_exec','container_poll','container_stop']);
export function validateAdvisorPolicy(config){
 const a=config?.advisor_mcp;if(!a)return true;if(typeof a.enabled!=='boolean')throw Error('ADVISOR_ENABLED_INVALID');if(!a.enabled)return true;
 const l=a.listen;if(!l||!LOOPBACK_HOSTS.has(l.host)||!Number.isInteger(l.port)||l.port<1024||l.port>65535||l.path!=='/mcp')throw Error('ADVISOR_LISTEN_LOOPBACK_REQUIRED');
 const caller=(config.callers||[]).find(x=>x.id===a.gateway_caller);if(!caller||!['L1','L2'].includes(caller.level)||!(typeof caller.token==='string'||typeof caller.token_file==='string'&&isAbsolute(caller.token_file)))throw Error('ADVISOR_GATEWAY_CALLER_REQUIRED');
 if(!a.roots||Array.isArray(a.roots)||typeof a.roots!=='object'||(!Object.keys(a.roots).length&&(!Array.isArray(a.file_operations)||a.file_operations.length)))throw Error('ADVISOR_ROOTS_REQUIRED');for(const [name,path]of Object.entries(a.roots)){if(!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(name)||typeof path!=='string'||!isAbsolute(path))throw Error('ADVISOR_ROOT_INVALID');}
 if(!Array.isArray(a.write_roots||[]))throw Error('ADVISOR_WRITE_ROOT_INVALID');for(const name of a.write_roots||[])if(!Object.hasOwn(a.roots,name))throw Error('ADVISOR_WRITE_ROOT_INVALID');
 for(const [field,allowed,code]of [['file_operations',ADVISOR_FILE_OPS,'ADVISOR_FILE_OPERATIONS_INVALID'],['gateway_tools',ADVISOR_GATEWAY_TOOLS,'ADVISOR_GATEWAY_TOOLS_INVALID']])if(a[field]!==undefined&&(!Array.isArray(a[field])||a[field].some(x=>!allowed.has(x))||new Set(a[field]).size!==a[field].length))throw Error(code);
 const t=config.tunnel_client;if(t?.enabled){if(typeof t.binary!=='string'||!t.binary)throw Error('TUNNEL_CLIENT_BINARY_REQUIRED');if(typeof t.health_addr!=='string'||!/^127\.0\.0\.1:[0-9]+$/.test(t.health_addr))throw Error('TUNNEL_HEALTH_LOOPBACK_REQUIRED');const target=t.target_url||config.existing_tunnel?.old_target;let u;try{u=new URL(target)}catch{throw Error('TUNNEL_TARGET_INVALID')}if(u.protocol!=='http:'||!LOOPBACK_HOSTS.has(u.hostname)||u.port!==String(l.port)||u.pathname!==l.path||u.username||u.password||u.search||u.hash)throw Error('TUNNEL_TARGET_MISMATCH');}
 return true;
}
async function canonical(path){if(!isAbsolute(path))throw Error('ABSOLUTE_PROTECTED_PATH_REQUIRED');let p=resolve(path),tail=[];for(;;){try{const base=await realpath(p);return resolve(base,...tail);}catch(e){if(e.code!=='ENOENT')throw e;const next=dirname(p);if(next===p)throw e;tail.unshift(basename(p));p=next;}}}
export function checkContainerBoundary(d,protectedPaths){
 if(d.HostConfig?.Privileged||d.HostConfig?.PidMode==='host')throw Error('CONTAINER_HOST_PRIVILEGE_EXPOSED');
 for(const m of d.Mounts||[]){
  if((m.Source||'').includes('docker.sock')||(m.Destination||'').includes('docker.sock'))throw Error('CONTAINER_DAEMON_EXPOSED');
  if(m.Source&&protectedPaths.some(p=>within(p,resolve(m.Source))||within(resolve(m.Source),p)))throw Error('CONTAINER_CONTROL_PLANE_EXPOSED');
 }
}
export async function checkLiveContainerBoundary(d,protectedPaths){
 const safe={...d,Mounts:await Promise.all((d.Mounts||[]).map(async m=>({...m,Source:m.Source?await canonical(m.Source):m.Source})))};
 checkContainerBoundary(safe,protectedPaths);
}
export async function validateContainerBoundaries(config,protectedPaths){
 for(const c of config.containers||[]){
  if(!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(c.name))throw Error('INVALID_CONTAINER_NAME');
  const {stdout}=await exec('/usr/bin/docker',['inspect','--format','{{json .}}',c.name],{timeout:5000,maxBuffer:1048576});
  await checkLiveContainerBoundary(JSON.parse(stdout),protectedPaths);
 }
}
// Both inline credentials (protected by the instance file) and optional legacy
// model credential references belong to the control plane.
export function modelSecretPaths(config) {
 const out=[];
 const walk=x=>{if(!x||typeof x!=='object')return;for(const[k,v]of Object.entries(x)){if(['api_key_file','apiKeyFile','apiKey_file'].includes(k)&&typeof v==='string')out.push(v);else if(v&&typeof v==='object')walk(v);}};
 walk(config.models);return out;
}
export async function validateConfigBoundary(config,configPath,installRoot){
 validateAdvisorPolicy(config);
 const paths=[configPath,installRoot,config.audit,...(config.callers||[]).map(c=>c.token_file),...(config.protected_paths||[]),...modelSecretPaths(config)];
 if(config.agents){if(!isAbsolute(config.agents.state_file||''))throw Error('ABSOLUTE_AGENT_STATE_REQUIRED');paths.push(config.agents.state_file);for(const p of [...Object.values(config.agents.backends||{}),...Object.values(config.agents.host_backends||{}),...(config.agents.host_backend?[config.agents.host_backend]:[])]){if(typeof p!=='string'||!isAbsolute(p))throw Error('ABSOLUTE_BACKEND_RECORD_REQUIRED');let b;try{b=JSON.parse(await readFile(p,'utf8'));}catch{throw Error('BACKEND_RECORD_INVALID');}const credential=b.api_major===2?b.connection_file:b.password_file;if(!isAbsolute(credential||''))throw Error('ABSOLUTE_BACKEND_CREDENTIAL_REQUIRED');const credentialPaths=credentialReferencePaths(b.container_credential_environment_files);if(b.target==='host'&&credentialPaths.length)throw Error('HOST_CONTAINER_CREDENTIAL_ENV_DENIED');paths.push(dirname(p),credential);if(b.target==='host'){for(const field of ['root','binary','guard_file','proof_file',...(b.gateway_token_file?['gateway_token_file']:[])]){if(!isAbsolute(b[field]||''))throw Error('ABSOLUTE_HOST_CONTROL_REQUIRED');paths.push(b[field]);}}}}
 if(config.agents?.host_scopes_file){if(!isAbsolute(config.agents.host_scopes_file))throw Error('ABSOLUTE_HOST_SCOPES_REQUIRED');paths.push(config.agents.host_scopes_file);}
 if(config.host_git)for(const field of ['guard_file','scratch_root']){if(!isAbsolute(config.host_git[field]||''))throw Error('ABSOLUTE_HOST_GIT_CONTROL_REQUIRED');paths.push(config.host_git[field]);}
 const key=config.existing_tunnel?.api_key_file;if(key&&isAbsolute(key))paths.push(key);
 const protectedPaths=await Promise.all(paths.filter(Boolean).map(canonical));
 for(const roots of [config.host_read_roots,config.host_write_roots,config.advisor_mcp?.roots])for(const path of Object.values(roots||{})){
  if(!isAbsolute(path))throw Error('ABSOLUTE_ROOT_REQUIRED');let s;try{s=await lstat(path);}catch{throw Error('CANONICAL_ROOT_REQUIRED');}if(!s.isDirectory()||s.isSymbolicLink())throw Error('CANONICAL_ROOT_REQUIRED');const root=await realpath(path);
  if(protectedPaths.some(p=>within(p,root)||within(root,p)))throw Error('CONTROL_PLANE_ROOT_OVERLAP');
 }
 return protectedPaths;
}
