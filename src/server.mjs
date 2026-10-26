import {createServer} from 'node:http';
import {readFile,stat,appendFile,mkdir} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {timingSafeEqual,randomUUID} from 'node:crypto';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {z} from 'zod';
import {identity,hostFile,diagnostic,Containers} from './core.mjs';
import {hostGit} from './host-git.mjs';
import {HostScopes} from './host-scopes.mjs';
import {validateConfigBoundary,validateContainerBoundaries} from './config-policy.mjs';
import {fileURLToPath} from 'node:url';
import {loadInstance,readSecret} from './instance-config.mjs';
import {fullL2} from './full-access.mjs';
import {hostJobDefinitions,hostJobCall} from './host-jobs.mjs';
import {runtimeHealth} from './runtime-client.mjs';
const path=process.env.AGENT_MCP_CONFIG||fileURLToPath(new URL('../config/instance.local.json',import.meta.url));
const config=await loadInstance(path);
const protectedPaths=await validateConfigBoundary(config,path,fileURLToPath(new URL('..',import.meta.url)));
Object.defineProperty(config,'__protected_paths',{value:protectedPaths});
if(config.permissions?.l2!=='full')await validateContainerBoundaries(config,protectedPaths);
if(!['127.0.0.1','::1'].includes(config.listen?.host))throw Error('LOOPBACK_REQUIRED');
for(const roots of [config.host_read_roots,config.host_write_roots])for(const p of Object.values(roots||{}))if(!isAbsolute(p))throw Error('ABSOLUTE_ROOT_REQUIRED');
const callers=[];
for(const c of config.callers||[]){if(!['L1','L2'].includes(c.level)||!c.id)throw Error('INVALID_POLICY');if(c.token_file){const s=await stat(c.token_file);if((s.mode&0o077)!==0||s.uid!==process.getuid())throw Error('PRIVATE_TOKEN_REQUIRED');}const token=await readSecret(c,'token','token_file');if(token.length<32)throw Error('TOKEN_TOO_SHORT');if(callers.some(x=>x.token===token||x.id===c.id))throw Error('DUPLICATE_CALLER');callers.push({...c,token});}
if(!callers.length)throw Error('CALLERS_REQUIRED');
await mkdir(dirname(config.audit),{recursive:true,mode:0o700});
const containers=new Containers(config,protectedPaths);if(config.agents?.host_scopes_file){const scopes=await new HostScopes(config.agents.host_scopes_file).load();Object.defineProperty(config,'__host_scopes',{value:scopes});Object.defineProperty(config,'__stop_host_children',{value:async(task,owner)=>{await scopes.revoke(task,owner);const children=await scopes.children(task,owner),out=[];for(const child of children){try{out.push(await containers.stopBound(child,task,owner));}catch(e){out.push({task_id:child.id,stop_requested:false,code:e.message});}}return out;}});}const registry=new Map();
const add=(name,description,schema,fn)=>registry.set(name,{name,description,inputSchema:z.toJSONSchema(schema),schema,fn});
if(config.permissions?.l2==='full')for(const d of hostJobDefinitions)add(d.name,d.description,d.schema,(caller,a)=>hostJobCall(config,caller,d.name,a));
add('gateway_status','Machine identity, permission baseline and actual OpenCode backend health; no secrets.',z.object({}),async()=>{const backends=config.runtime?.version==='2.1.2'?await runtimeHealth(config):[];return{...identity(),machine_id:config.machine_id,permission_levels:['L1','L2'],l2_mode:config.permissions?.l2==='full'?'full-os-user':'legacy-scoped',host_read_roots:config.host_read_roots,host_write_roots:config.host_write_roots,host_opencode:config.runtime?.host?.enabled?(backends.find(b=>b.target==='host')?.status||'unavailable'):config.opencode_host?.enabled?'configured-not-verified':'disabled',containers:(config.containers||[]).map(c=>c.name),opencode_backends:config.runtime?.version==='2.1.2'?backends:Object.keys(config.agents?.backends||{}),native_session_state:config.runtime?.version==='2.1.2'?'native-2.1.2':config.agents?.state_file?'configured':'disabled'}});
add('host_file','L1 reads/info/list; L2 mutations only within named configured roots. Symlinks and hardlinked files rejected. Delete only a file or empty directory; rename only a regular single-link file within the same root, never overwrite.',z.object({action:z.enum(['list','read','info','write','edit','mkdir','delete','rename']),root:z.string(),path:z.string().default('.'),destination:z.string().optional(),text:z.string().max(1048576).optional(),old_string:z.string().optional(),new_string:z.string().optional()}), (c,a)=>hostFile(config,c,a));
add('host_search','Bounded filename glob or literal text search within a named read root; no symlink traversal, no regex execution, hidden files excluded by default.',z.object({mode:z.enum(['files','text']),root:z.string(),path:z.string().default('.'),query:z.string().min(1).max(256).optional(),pattern:z.string().max(256).default('*'),include_hidden:z.boolean().default(false),max_results:z.number().int().min(1).max(100).default(50)}),(c,a)=>hostFile(config,c,{...a,action:a.mode==='files'?'search_files':'search_text'}));
add('host_diagnostic','Fixed low-risk diagnostic templates; never arbitrary shell.',z.object({command:z.enum(['identity','disk','memory','uptime','git_summary']),root:z.string().max(128).optional(),path:z.string().max(4096).optional()}),(caller,a)=>a.command==='git_summary'?hostGit(config,caller,a):diagnostic(caller,a));
add('container_list','Only registered containers and their real writable mounts.',z.object({}),()=>containers.list());
add('container_exec','L2 arbitrary shell in a registered container, including default root; writable host mounts are affected. Never arbitrary Docker control.',z.object({container:z.string(),command:z.string().min(1).max(65536),cwd:z.string(),wait_ms:z.number().int().min(0).max(2000).optional()}),(c,a)=>containers.start(c,a));
add('container_poll','Read newly captured output only for caller-owned tasks.',z.object({task_id:z.string()}),(c,a)=>containers.poll(c,a));
add('container_stop','Stop the recorded container task process group.',z.object({task_id:z.string()}),(c,a)=>containers.stop(c,a));
// Optional adapters remain absent until implemented; never silently substitute another backend.
try{const {agentTools,agentCall}=await import('./agents.mjs');if(!Array.isArray(agentTools)||typeof agentCall!=='function')throw Error('AGENT_CONTRACT_INVALID');for(const t of agentTools){if(registry.has(t.name))throw Error('DUPLICATE_TOOL');const schema=config.runtime?.version==='2.1.2'&&t.name==='opencode_start'?t.schema.extend({target:z.enum(['host','container'])}):t.schema;registry.set(t.name,{...t,schema,inputSchema:z.toJSONSchema(schema),fn:(c,a)=>agentCall(config,c,t.name,a)});}}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND'||e.url!==new URL('./agents.mjs',import.meta.url).href)throw e;}
for(const c of callers)if(c.allowed_tools!==undefined&&(!Array.isArray(c.allowed_tools)||c.allowed_tools.some(n=>typeof n!=='string'||!registry.has(n))||new Set(c.allowed_tools).size!==c.allowed_tools.length))throw Error('INVALID_TOOL_SCOPE');
function authorize(req){const b=Buffer.from(req.headers.authorization||'');return callers.find(c=>{const a=Buffer.from('Bearer '+c.token);return a.length===b.length&&timingSafeEqual(a,b);});}
const http=createServer(async(req,res)=>{
 if(req.url==='/healthz'&&req.method==='GET'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({ok:true,machine_id:config.machine_id}));return;}
 if(req.url!=='/mcp'){res.writeHead(404).end();return;}
 const caller=authorize(req)||config.__host_scopes?.authenticate(req.headers.authorization);if(!caller){res.writeHead(401,{'www-authenticate':'Bearer'}).end();return;}
 if(req.method!=='POST'){res.writeHead(405).end();return;}
 if(req.headers.origin&&!['http://127.0.0.1','http://localhost'].includes(req.headers.origin)){res.writeHead(403).end();return;}
 const server=new Server({name:'agent-mcp',version:'1.3.0'},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[...registry.values()].map(({name,description,inputSchema})=>({name,description,inputSchema}))}));
 server.setRequestHandler(CallToolRequestSchema,async r=>{
  const request_id=randomUUID(),start=Date.now();let ok=false;
  try{const t=registry.get(r.params.name);if(!t)throw Error('TOOL_DENIED');if(!fullL2(config,caller)&&caller.allowed_tools&&!caller.allowed_tools.includes(t.name))throw Error('TOOL_SCOPE_DENIED');const args=t.schema?t.schema.strict().parse(r.params.arguments||{}):(r.params.arguments||{});const result=await t.fn(caller,args);ok=true;return {content:[{type:'text',text:JSON.stringify({ok:true,request_id,result})}]};}
  catch(e){return {isError:true,content:[{type:'text',text:JSON.stringify({ok:false,request_id,code:/^[A-Z][A-Z0-9_]+$/.test(e.message)?e.message:'OPERATION_FAILED'})}]};}
  finally{await appendFile(config.audit,JSON.stringify({time:new Date().toISOString(),request_id,caller:caller.id,level:caller.level,tool:r.params.name,ok,duration_ms:Date.now()-start})+'\n',{mode:0o600});}
 });
 const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
 res.on('close',()=>{void transport.close();void server.close();});
 try{await server.connect(transport);await transport.handleRequest(req,res);}catch{if(!res.headersSent)res.writeHead(500);if(!res.writableEnded)res.end();}
});
http.requestTimeout=30000;http.maxHeadersCount=64;
http.listen(config.listen.port,config.listen.host,()=>console.error('agent-mcp listening '+config.listen.host+':'+config.listen.port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>http.close(()=>process.exit(0)));
