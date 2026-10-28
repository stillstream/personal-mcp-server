import {lstat,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {OpenCode} from '@opencode/client';
import {sessionConcurrency} from './native-concurrency.mjs';
import {Service} from '@opencode/client/service';
import {PROJECT_ROOT} from './instance-config.mjs';
export const RUNTIME_VERSION='2.1.2';
export function runtimeDirectory(target,name){if(target==='host')return join(PROJECT_ROOT,'.local/runtime/host');if(target!=='container'||!name||!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name))throw Error('RUNTIME_TARGET_INVALID');return join(PROJECT_ROOT,'.local/runtime/containers',name);}
export async function privateRecord(file){const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o077))throw Error('PRIVATE_RUNTIME_RECORD_REQUIRED');try{return JSON.parse(await readFile(file,'utf8'));}catch{throw Error('RUNTIME_RECORD_INVALID');}}
// Fixed loopback proxy inside a container: no published port or host networking is required.
const proxy=String.raw`import sys,json,urllib.request,urllib.error,base64
x=json.load(sys.stdin)
u='http://127.0.0.1:'+str(int(x['port']))+x['path']
r=urllib.request.Request(u,data=base64.b64decode(x['body']) if x.get('body') else None,headers=x.get('headers',{}),method=x['method'])
try:
 q=urllib.request.urlopen(r,timeout=15)
except urllib.error.HTTPError as e:
 q=e
b=q.read(2097153)
if len(b)>2097152: raise RuntimeError('NATIVE_OUTPUT_LIMIT')
print(json.dumps({'status':q.status,'headers':dict(q.headers),'body':base64.b64encode(b).decode()}))
`;
export async function runtimeFetch(record,input,init={}){const u=new URL(typeof input==='string'||input instanceof URL?input:input.url);if(u.origin!==record.url)throw Error('NATIVE_REDIRECT_DENIED');if(record.target==='host')return fetch(input,{...init,redirect:'error'});
 const request=input instanceof Request?input:null;const merged=new Headers(request?.headers);for(const[k,v]of new Headers(init.headers||{}))merged.set(k,v);merged.set('accept-encoding','identity');const headers=Object.fromEntries(merged);const method=init.method||request?.method||'GET';let payload=init.body;if(payload===undefined&&request&&!['GET','HEAD'].includes(method))payload=await request.clone().arrayBuffer();const body=payload?Buffer.from(typeof payload==='string'?payload:payload instanceof ArrayBuffer?payload:await new Response(payload).arrayBuffer()).toString('base64'):'';
 const data=JSON.stringify({port:record.port,path:u.pathname+u.search,method,headers,body});
 const result=await new Promise((ok,fail)=>{const p=spawn('/usr/bin/docker',['exec','-i',record.container_id,'python3','-c',proxy],{stdio:['pipe','pipe','pipe']});let out='',err=0;const timer=setTimeout(()=>p.kill('SIGKILL'),20000);p.stdout.on('data',b=>{out+=b;if(out.length>3000000)p.kill('SIGKILL')});p.stderr.on('data',b=>err+=b.length);p.on('error',()=>{clearTimeout(timer);fail(Error('CONTAINER_API_PROXY_FAILED'))});p.on('close',code=>{clearTimeout(timer);if(code!==0)return fail(Error('CONTAINER_API_PROXY_FAILED'));try{ok(JSON.parse(out))}catch{fail(Error('CONTAINER_API_PROXY_INVALID'))}});p.stdin.on('error',()=>{});p.stdin.end(data);});
 return new Response([204,205,304].includes(result.status)?null:Buffer.from(result.body,'base64'),{status:result.status,headers:result.headers});}
export async function runtimeBackend(config,target,name){if(target==='container'&&!config.containers?.some(c=>c.name===name))throw Error('CONTAINER_NOT_REGISTERED');const desired=target==='host'?config.runtime?.host:config.containers.find(c=>c.name===name)?.opencode;if(!desired?.enabled)throw Error('RUNTIME_TARGET_DISABLED');const dir=runtimeDirectory(target,name);const record=await privateRecord(join(dir,'connection.json'));const auth=await privateRecord(join(dir,'auth.json'));if(desired.port!==record.port||desired.binary!==record.binary)throw Error('RUNTIME_CONFIG_RESTART_REQUIRED');if(record.version!==RUNTIME_VERSION||record.target!==target||record.container!==(name||null))throw Error('RUNTIME_IDENTITY_MISMATCH');
 const client=OpenCode.make({baseUrl:record.url,headers:Service.headers({url:record.url,auth:{type:'basic',username:'opencode',password:auth.password}}),fetch:(input,init)=>runtimeFetch(record,input,init)});
 const info=await client.server.info({signal:AbortSignal.timeout(10000)});if(info.version!==RUNTIME_VERSION||info.pid!==record.pid)throw Error('RUNTIME_IDENTITY_MISMATCH');
 if(target==='container'){const expected=config.containers.find(c=>c.name===name);if(expected.opencode?.container_id&&expected.opencode.container_id!==record.container_id)throw Error('CONTAINER_CHANGED');}
 return {...record,client};}
export async function runtimeHealth(config){const targets=[...(config.runtime?.host?.enabled?[{target:'host'}]:[]),...(config.containers||[]).filter(c=>c.opencode?.enabled).map(c=>({target:'container',name:c.name}))];return Promise.all(targets.map(async t=>{try{const b=await runtimeBackend(config,t.target,t.name);return {target:t.target,container:t.name||null,status:'ready',version:b.version,pid:b.pid,max_concurrent:sessionConcurrency(config,t.target,t.name)}}catch(e){return {target:t.target,container:t.name||null,status:'unavailable',code:/^[A-Z_]+$/.test(e.message)?e.message:'RUNTIME_UNAVAILABLE'}}}));}