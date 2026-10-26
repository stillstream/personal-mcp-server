#!/usr/bin/env node
import{createConnection}from'node:net';import{readFile,open}from'node:fs/promises';import{resolve}from'node:path';
function csvRow(line){const out=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const x=line[i];if(x==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(x===','&&!quoted){out.push(value);value='';}else value+=x;}out.push(value);return out;}
export function parseStats(csv){const lines=csv.trim().split('\n'),keys=csvRow(lines.shift().replace(/^# /,''));return lines.filter(Boolean).map(l=>Object.fromEntries(csvRow(l).map((v,i)=>[keys[i],v])));}
export function summarizeRoutes(c,rows,logs=[]){return c.models.map(m=>{
 const health=m.routes.map(r=>{const s=rows.find(x=>x.pxname==='bk_'+m.name&&x.svname===r.mode)||{};return {mode:r.mode,status:s.status||'UNKNOWN',check_status:s.check_status||null,check_code:s.check_code||null,last_check:s.last_chk||s.check_desc||s.check_status||null};});
 // UP 1/2 is still eligible until HAProxy's fall threshold is met; DOWN 1/2 is not.
 const active=health.find(x=>x.status==='UP'||x.status.startsWith('UP '));
 const historical=logs.filter(x=>x.includes('bk_'+m.name+'/')&&(x.includes(' is DOWN')||x.includes(' failed,'))).at(-1);
 return {id:m.id,url:'http://127.0.0.1:'+m.listen_port+'/v1',mode:active?.mode||'unavailable',health,last_failure_reason:historical||health.filter(x=>x.status!=='UP').map(x=>x.mode+': '+(x.last_check||x.status)+(x.check_code?' code='+x.check_code:'')).join('; ')||null};
});}
export async function routerStatus(c){
 const csv=await new Promise((resolve,reject)=>{const socket=createConnection(c.stats_socket);let out='';socket.setTimeout(3000);socket.on('connect',()=>socket.write('show stat\n'));socket.on('data',b=>{out+=b;if(out.length>1048576)socket.destroy(Error('STATS_LIMIT'));});socket.on('end',()=>resolve(out));socket.on('error',reject);socket.on('timeout',()=>socket.destroy(Error('STATS_TIMEOUT')));});
 let logs=[];if(c.log_file){let f;try{f=await open(c.log_file,'r');const size=(await f.stat()).size,buffer=Buffer.alloc(Math.min(size,65536));await f.read(buffer,0,buffer.length,Math.max(0,size-buffer.length));logs=buffer.toString().split('\n');}catch{}finally{await f?.close();}}
 return summarizeRoutes(c,parseStats(csv),logs);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname))console.log(JSON.stringify(await routerStatus(JSON.parse(await readFile(process.argv[2],'utf8'))),null,2));
