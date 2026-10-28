import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {PROJECT_ROOT} from '../src/instance-config.mjs';
if(!process.argv.includes('--live'))throw Error('EXPLICIT_LIVE_FLAG_REQUIRED');
const client=new Client({name:'resume-capacity-live-acceptance',version:'1'}),started=[],receipt={target:'host',limit:3,status:'pending',cleanup_pending:[],retained_fixtures:[],active_sessions:[]};let dir;
const parse=r=>JSON.parse(r.content.find(x=>x.type==='text').text);
async function call(name,args){const r=await client.callTool({name,arguments:args});const p=parse(r);if(r.isError||!p.ok)throw Error(p.code||'TOOL_FAILED:'+name);return p.result}
async function poll(id,predicate,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){const s=await call('opencode_status',{task_id:id});if(predicate(s))return s;if(['failed','aborted'].includes(s.status))throw Error('TASK_TERMINATED:'+s.status);await new Promise(r=>setTimeout(r,350));}throw Error('TASK_TIMEOUT:'+id)}
async function cleanup(id){try{let s=await call('opencode_status',{task_id:id});if(['completed','aborted','failed'].includes(s.status))return true;await call('opencode_abort',{task_id:id});s=await poll(id,x=>['completed','aborted','failed'].includes(x.status),15000);return true}catch{return false}}
try{
 const config=JSON.parse(await readFile(join(PROJECT_ROOT,'config/instance.local.json'),'utf8'));assert.equal(config.runtime.host.max_concurrent??3,3);
 const store=JSON.parse(await readFile(join(PROJECT_ROOT,'.local/native-tasks.json'),'utf8'));const active=Object.values(store.tasks).filter(t=>t.target==='host'&&['creating','submitted','running','queued','uncertain','aborting','abort_requested'].includes(t.phase));assert.equal(active.length,0,'HOST_TARGET_NOT_IDLE');
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8787/mcp')));const prior=Object.values(store.tasks).find(t=>t.target==='host'&&t.phase==='completed'&&t.cwd?.startsWith('/home/kevin/dsh-runtime/tmp/agent-mcp-native-'));assert(prior,'COMPLETED_SYNTHETIC_HOST_SESSION_REQUIRED');const priorStatus=await call('opencode_status',{task_id:prior.id});assert.equal(priorStatus.status,'completed');receipt.completed_session_id=prior.id;
 dir=await mkdtemp(join(tmpdir(),'agent-mcp-resume-capacity-'));
 for(let i=0;i<3;i++){const file=dir+'/marker-'+i+'.txt',marker='RESUME_CAP_'+i+'_'+randomUUID().replaceAll('-',''),command='sleep 20; printf '+marker+' > '+file,prompt='Synthetic capacity test only. Use the native shell tool to run exactly '+JSON.stringify(command)+'. Stay in this temporary directory and reply DONE after completion.';const task=await call('opencode_start',{target:'host',cwd:dir,prompt});started.push(task.task_id);receipt.active_sessions.push({task_id:task.task_id,session_id:task.session_id});}
 const status=[];for(const t of receipt.active_sessions)status.push(await poll(t.task_id,s=>s.status==='running',20000));assert.equal(new Set(receipt.active_sessions.map(t=>t.session_id)).size,3);receipt.simultaneously_running=status.filter(s=>s.status==='running').length;assert.equal(receipt.simultaneously_running,3);
 const overflow=await client.callTool({name:'opencode_start',arguments:{target:'host',cwd:dir,prompt:'This fourth synthetic Session must be rejected while three Host Sessions are active.'}});assert.equal(overflow.isError,true);assert.equal(parse(overflow).code,'NATIVE_CONCURRENCY_LIMIT');
 const resume=await client.callTool({name:'opencode_continue',arguments:{task_id:prior.id,prompt:'Synthetic capacity-guard probe only. Do not use tools. Reply RESUME_WAS_ACCEPTED.'}});receipt.resume_rejected=resume.isError&&parse(resume).code==='NATIVE_CONCURRENCY_LIMIT';if(!receipt.resume_rejected){const p=parse(resume);if(p.ok&&p.result?.status==='submitted')started.push(prior.id);throw Error('COMPLETED_SESSION_RESUME_BYPASSED_CAPACITY');}
 receipt.fourth_start_rejected=true;receipt.status='PASS';
}finally{
 for(const id of [...started].reverse())if(!await cleanup(id))receipt.cleanup_pending.push(id);await client.close().catch(()=>{});
 if(dir){if(receipt.cleanup_pending.length)receipt.retained_fixtures.push(dir);else await rm(dir,{recursive:true,force:true});}
 receipt.cleanup=receipt.cleanup_pending.length?'INCOMPLETE_FIXTURE_PRESERVED':'all started sessions reached terminal state; temporary fixture removed';if(receipt.cleanup_pending.length)receipt.status='FAIL_CLEANUP';
 await writeFile(join(PROJECT_ROOT,'.local/verification/native-resume-capacity-live.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
}
if(receipt.status!=='PASS')process.exitCode=1;console.log(JSON.stringify(receipt));