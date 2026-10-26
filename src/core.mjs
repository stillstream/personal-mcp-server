import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {checkLiveContainerBoundary} from './config-policy.mjs';
import {taskScript,signalScript} from './container-process.mjs';
import{fullL2,fullHostFile}from'./full-access.mjs';
const exec=promisify(execFile);
const env={PATH:'/usr/bin:/bin',LANG:'C.UTF-8',HOME:'/nonexistent'};
export const identity=()=>({hostname:hostname(),uid:process.getuid(),gid:process.getgid()});
export function requireL2(c){if(c.level!=='L2')throw Error('L2_REQUIRED');}
export async function hostFile(config,caller,a){
 if(fullL2(config,caller))return fullHostFile(config,caller,a);
 if(['write','edit','delete','mkdir','rename'].includes(a.action))requireL2(caller);
 const roots=['write','edit','delete','mkdir','rename'].includes(a.action)?config.host_write_roots:config.host_read_roots;
 const input=JSON.stringify({roots,action:a.action,args:a});
 return await new Promise((resolve,reject)=>{
 const p=spawn('/usr/bin/python3',[fileURLToPath(new URL('./host-worker.py',import.meta.url))],{env,stdio:['pipe','pipe','pipe']});
 let out='';const timer=setTimeout(()=>p.kill(),10000);p.stdout.on('data',b=>{out+=b;if(out.length>2200000)p.kill();});
 p.on('error',reject);p.on('close',()=>{clearTimeout(timer);try{const r=JSON.parse(out);if(!r.ok)reject(Error(r.code));else resolve({...r.result,...identity()});}catch(e){reject(e);}});p.stdin.on('error',()=>{});p.stdin.end(input);
 });
}
export async function diagnostic(caller,a){
 const templates={identity:['/usr/bin/id',[]],disk:['/usr/bin/df',['-h']],memory:['/usr/bin/free',['-m']],uptime:['/usr/bin/uptime',[]]};
 if(!templates[a.command])throw Error('COMMAND_DENIED');
 const [bin,args]=templates[a.command];const r=await exec(bin,args,{env,timeout:5000,maxBuffer:65536});return {...identity(),stdout:r.stdout,stderr:r.stderr};
}
// The daemon is accessible only to this trusted broker, never passed into agent sandboxes.
export class Containers{
 constructor(config,protectedPaths=[]){this.config=config;this.protectedPaths=protectedPaths;this.tasks=new Map();}
 async target(name){
  if(!this.config.containers?.some(x=>x.name===name))throw Error('CONTAINER_DENIED');
  const {stdout}=await exec('/usr/bin/docker',['inspect','--format','{{json .}}',name],{timeout:5000,maxBuffer:1048576});
  const d=JSON.parse(stdout);
  if(this.config.permissions?.l2!=='full')await checkLiveContainerBoundary(d,this.protectedPaths);
  if(!d.State.Running)throw Error('CONTAINER_NOT_RUNNING');
  return d;
 }
 async list(){const out=[];for(const c of this.config.containers||[]){try{const d=await this.target(c.name);out.push({name:c.name,id:d.Id,hostname:d.Config.Hostname,user:d.Config.User||'0',network:d.HostConfig.NetworkMode,mounts:d.Mounts.map(m=>({source:m.Source,destination:m.Destination,writable:m.RW}))});}catch{out.push({name:c.name,status:'unavailable'});}}return out;}
 async start(caller,a){
  requireL2(caller);const d=await this.target(a.container);
  if(!a.cwd?.startsWith('/')||a.cwd.includes('\0'))throw Error('CWD_DENIED');
  const active=[...this.tasks.values()].filter(t=>t.code===null&&!t.closed);if(active.length>=16)throw Error('TASK_LIMIT');
  for(const [id,t] of this.tasks)if(t.closed&&Date.now()-t.created>7200000)this.tasks.delete(id);
  if(this.tasks.size>=128)throw Error('TASK_RECORD_LIMIT');
  const id=randomUUID(), marker='agent-mcp-'+id;
  // Container PID file identifies the exact process group for targeted termination.
  const admission={id,owner:caller.id,parent_task_id:caller.parent_task_id,container:a.container,containerId:d.Id,marker,created:Date.now()};if(caller.parent_task_id){if(!this.config.__host_scopes)throw Error('HOST_SCOPE_REQUIRED');await this.config.__host_scopes.child(caller,admission);this.config.__host_scopes.assertActive(caller);}
  const script=taskScript(marker);
  const child=spawn('/usr/bin/docker',['exec','-w',a.cwd,d.Id,'setsid','--wait','/bin/bash','-c',script,'agent-mcp',a.command],{stdio:['ignore','pipe','pipe']});
  const t={id,owner:caller.id,parent_task_id:caller.parent_task_id,container:a.container,containerId:d.Id,execution_user:d.Config.User||'0',container_hostname:d.Config.Hostname,marker,child,code:null,closed:false,stdout:'',stderr:'',truncated:false,created:Date.now()};
  for(const k of ['stdout','stderr'])child[k].on('data',b=>{t[k]+=b.toString();if(t[k].length>1048576){t[k]=t[k].slice(-1048576);t.truncated=true;}});
  child.on('error',()=>{t.code=127;t.closed=true;});child.on('close',code=>{t.code=code;t.closed=true;void exec('/usr/bin/docker',['exec',t.containerId,'rm','-f','--','/tmp/'+t.marker+'.pid'],{timeout:5000,maxBuffer:4096}).catch(()=>{});});this.tasks.set(id,t);
  await new Promise(r=>setTimeout(r,Math.min(a.wait_ms??100,2000)));return this.poll(caller,{task_id:id});
 }
 owned(caller,id){const t=this.tasks.get(id);if(!t||t.owner!==caller.id)throw Error('TASK_DENIED');return t;}
 poll(caller,a){const t=this.owned(caller,a.task_id);const budget=32768;const out={...identity(),task_id:t.id,container:t.container,container_id:t.containerId,execution_user:t.execution_user,container_hostname:t.container_hostname,status:t.closed?'completed':'running',exit_code:t.code,stdout:t.stdout.slice(0,budget),stderr:t.stderr.slice(0,budget),truncated:t.truncated,has_more:t.stdout.length>budget||t.stderr.length>budget};t.stdout=t.stdout.slice(budget);t.stderr=t.stderr.slice(budget);return out;}
 async stopBound(record,parent,owner){if(record.parent!==parent||record.frontend_owner!==owner||record.marker!=='agent-mcp-'+record.id)throw Error('HOST_CHILD_DENIED');if(this.tasks.has(record.id))return this.stop({id:record.owner,level:'L2'},{task_id:record.id});const d=await this.target(record.container);if(d.Id!==record.containerId)throw Error('CONTAINER_CHANGED');await exec('/usr/bin/docker',['exec',d.Id,'/bin/bash','-c',signalScript(record.marker,'TERM')],{timeout:5000,maxBuffer:4096});await new Promise(r=>setTimeout(r,1200));await exec('/usr/bin/docker',['exec',d.Id,'/bin/bash','-c',signalScript(record.marker,'KILL')],{timeout:5000,maxBuffer:4096});return{task_id:record.id,stop_requested:true,recovered:true};}
 async stop(caller,a){requireL2(caller);const t=this.owned(caller,a.task_id);if(t.closed)return this.poll(caller,a);
  // Do not kill a recycled container name; inspect and use original immutable ID.
  const d=await this.target(t.container);if(d.Id!==t.containerId)throw Error('CONTAINER_CHANGED');
  await exec('/usr/bin/docker',['exec',d.Id,'/bin/bash','-c',signalScript(t.marker,'TERM')],{timeout:5000,maxBuffer:4096});
  if(!t.closed)await Promise.race([new Promise(r=>t.child.once('close',r)),new Promise(r=>setTimeout(r,1200))]);
  if(!t.closed)await exec('/usr/bin/docker',['exec',d.Id,'/bin/bash','-c',signalScript(t.marker,'KILL')],{timeout:5000,maxBuffer:4096});
  return {...this.poll(caller,a),stop_requested:true};
 }
}
