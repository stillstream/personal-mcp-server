#!/usr/bin/env node
import {readFile,writeFile,open,unlink,rename} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {OpenCode} from '@opencode/client';
import {Service} from '@opencode/client/service';
import {runtimeDirectory,privateRecord,runtimeFetch,RUNTIME_VERSION} from '../src/runtime-client.mjs';
import {taskScript,signalScript} from '../src/container-process.mjs';
const exec=promisify(execFile),[target,name]=process.argv.slice(2);
const dir=runtimeDirectory(target,name),meta=await privateRecord(join(dir,'backend.json')),auth=await privateRecord(join(dir,'auth.json'));
if(meta.version!==RUNTIME_VERSION||meta.target!==target||meta.container!==(name||null))throw Error('RUNTIME_RECORD_MISMATCH');
if(target==='container')meta.marker='agent-mcp-'+randomUUID();
let lock;const lockPath=join(dir,'manager.lock');try{lock=await open(lockPath,'wx',0o600)}catch(e){if(e.code!=='EEXIST')throw e;const old=await privateRecord(lockPath);let alive=true;try{process.kill(old.pid,0)}catch(x){if(x.code==='ESRCH')alive=false;else throw x}if(alive)throw Error('RUNTIME_MANAGER_ALREADY_RUNNING');await unlink(lockPath);lock=await open(lockPath,'wx',0o600)}
await lock.writeFile(JSON.stringify({pid:process.pid}));
const root=meta.profile_root,paths={HOME:root+'/home',XDG_CONFIG_HOME:root+'/config',XDG_DATA_HOME:root+'/data',XDG_STATE_HOME:root+'/state',XDG_CACHE_HOME:root+'/cache',TMPDIR:root+'/tmp',OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_LOG_LEVEL:'error'};
let child,closed,ended=false,stopping=false,published=false,stderrBytes=0;
async function stop(code=0){if(stopping)return;stopping=true;try{if(child&&!ended){if(target==='container'){for(const sig of ['TERM','KILL']){await exec('/usr/bin/docker',['exec',meta.container_id,'/bin/bash','-c',signalScript(meta.marker,sig)],{timeout:5000,maxBuffer:4096}).catch(()=>{});if(sig==='TERM')await new Promise(r=>setTimeout(r,800));}}else{try{process.kill(-child.pid,'SIGTERM')}catch{}await Promise.race([closed,new Promise(r=>setTimeout(r,1500))]);if(!ended)try{process.kill(-child.pid,'SIGKILL')}catch{}}}if(published){const rec=await privateRecord(join(dir,'connection.json')).catch(()=>null);if(rec?.manager_pid===process.pid)await unlink(join(dir,'connection.json')).catch(()=>{});}await lock.close();await unlink(lockPath).catch(()=>{});}finally{process.exit(code)}}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>void stop(0));
try{
 let bin,args,options;
 if(target==='host'){bin=meta.binary;args=['serve','--service','--hostname','127.0.0.1','--port',String(meta.port)];options={cwd:meta.cwd,env:{PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',...paths},detached:true,stdio:['ignore','ignore','pipe']};}
 else{const d=JSON.parse((await exec('/usr/bin/docker',['inspect','--format','{{json .}}',meta.container],{timeout:5000})).stdout);if(d.Id!==meta.container_id||!d.State.Running)throw Error('CONTAINER_CHANGED_OR_STOPPED');const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";const command=['exec',meta.binary,'serve','--service','--hostname','127.0.0.1','--port',String(meta.port)].map((s,i)=>i===0?s:quote(s)).join(' ');bin='/usr/bin/docker';args=['exec','-w',meta.cwd,...Object.entries(paths).flatMap(([k,v])=>['-e',k+'='+v]),meta.container_id,'setsid','--wait','/bin/bash','-c',taskScript(meta.marker),'agent-mcp',command];options={stdio:['ignore','ignore','pipe']};}
 child=spawn(bin,args,options);closed=new Promise(ok=>{child.once('close',code=>{ended=true;ok(code);if(!stopping)void stop(code||1)});child.once('error',()=>{ended=true;ok(127);if(!stopping)void stop(127)});});child.stderr.on('data',b=>stderrBytes+=b.length);
 const record={...meta,url:'http://127.0.0.1:'+meta.port,manager_pid:process.pid};
 const headers=Service.headers({url:record.url,auth:{type:'basic',username:'opencode',password:auth.password}});
 const client=OpenCode.make({baseUrl:record.url,headers,fetch:(input,init)=>runtimeFetch(record,input,init)});
 let info;const deadline=Date.now()+45000;while(Date.now()<deadline&&!ended&&!stopping){try{const no=await runtimeFetch(record,record.url+'/api/info',{signal:AbortSignal.timeout(1500)});if(no.status!==401)throw Error('NATIVE_AUTH_REQUIRED');info=await client.server.info({signal:AbortSignal.timeout(2500)});if(info.version!==RUNTIME_VERSION)throw Error('NATIVE_VERSION_MISMATCH');break;}catch(e){if(e.message==='NATIVE_VERSION_MISMATCH')throw e;await new Promise(r=>setTimeout(r,150));}}
 if(!info)throw Error('NATIVE_READY_TIMEOUT');record.pid=info.pid;
 if(target==='host'){const tail=(await readFile('/proc/'+info.pid+'/stat','utf8')).split(') ').at(-1).split(' ');if(Number(tail[2])!==child.pid)throw Error('NATIVE_PROCESS_GROUP_MISMATCH');record.start_ticks=tail[19];}
 else{const verify='import os,sys; p=int(sys.argv[1]); leader=int(open("/tmp/"+sys.argv[2]+".pid").read().split()[0]); assert os.getpgid(p)==leader';await exec('/usr/bin/docker',['exec',meta.container_id,'python3','-c',verify,String(info.pid),meta.marker],{timeout:5000});}
 const temporary=join(dir,'connection.json.'+process.pid);await writeFile(temporary,JSON.stringify(record),{mode:0o600});await rename(temporary,join(dir,'connection.json'));published=true;
 console.log(JSON.stringify({status:'ready',target,container:name||null,version:info.version,pid:info.pid,authentication_verified:true,permission_profile:'full-native'}));await closed;
}catch(e){console.error(JSON.stringify({code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'RUNTIME_START_FAILED',stderr_bytes:stderrBytes}));await stop(1);}
