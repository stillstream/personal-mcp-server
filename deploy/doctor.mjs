#!/usr/bin/env node
import {readFile,stat,access} from 'node:fs/promises';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {hostname} from 'node:os';import {isAbsolute} from 'node:path';import {Containers} from '../src/core.mjs';
const {loadInstance,readSecret}=await import('../src/instance-config.mjs');const run=promisify(execFile),checks=[];const c=await loadInstance(process.env.AGENT_MCP_CONFIG||process.argv[2]);
function add(name,status,evidence){checks.push({name,status,evidence});}
add('runtime','PASS',{hostname:hostname(),uid:process.getuid(),node:process.version,machine_id:c.machine_id});
add('loopback-listener',['127.0.0.1','::1'].includes(c.listen?.host)?'PASS':'FAIL',c.listen);
for(const kind of ['host_read_roots','host_write_roots'])for(const [name,p]of Object.entries(c[kind]||{})){try{const s=await stat(p);add(kind+':'+name,isAbsolute(p)&&s.isDirectory()?'PASS':'FAIL',{path:p});}catch{add(kind+':'+name,'FAIL','directory unavailable');}}
for(const caller of c.callers||[]){try{const t=await readSecret(caller,'token','token_file');add('caller:'+caller.id,t.length>=32&&['L1','L2'].includes(caller.level)?'PASS':'FAIL',{level:caller.level,secret_source:caller.token_file?'reference':'instance'});}catch{add('caller:'+caller.id,'FAIL','private token unavailable');}}
for(const [name,bin,args]of [['python','/usr/bin/python3',['--version']],['docker','/usr/bin/docker',['version','--format','{{.Client.Version}}']]]){try{const r=await run(bin,args,{timeout:5000,maxBuffer:4096});add(name,'PASS',r.stdout.trim());}catch{add(name,'FAIL','command unavailable');}}
const containers=await new Containers(c).list();add('containers',containers.every(x=>x.id)?'PASS':'FAIL',containers);
add('host-opencode-isolation','NOT_TESTED',c.opencode_host?.enabled?'requires real isolation tests; configuration is not evidence':'disabled/fail-closed');
add('ChatGPT-and-DSH-real-clients','NOT_TESTED','Reference SDK tests do not prove GUI or DSH plugin calls');
console.log(JSON.stringify({checks,acceptance_complete:false},null,2));if(checks.some(x=>x.status==='FAIL'))process.exitCode=1;
