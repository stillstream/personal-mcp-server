import{isAbsolute}from'node:path';const allowed=new Set(['CONTAINER_MCP_TOKEN']);export function credentialReferencePaths(refs){if(refs===undefined)return[];if(!refs||typeof refs!=='object'||Array.isArray(refs)||Object.entries(refs).some(([name,path])=>!allowed.has(name)||typeof path!=='string'||!isAbsolute(path)||path.includes(String.fromCharCode(0))))throw Error('CREDENTIAL_ENV_REFERENCE_DENIED');return Object.values(refs);}export const credentialExecPython=String.raw`import os,sys,json,stat
try:
 refs=json.loads(sys.argv[1]); values={}
 if not isinstance(refs,dict) or any(k!='CONTAINER_MCP_TOKEN' for k in refs): raise ValueError()
 for name,path in refs.items():
  if not isinstance(path,str) or not os.path.isabs(path) or os.path.realpath(path)!=path: raise ValueError()
  fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   s=os.fstat(fd)
   if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.geteuid() or s.st_nlink!=1 or s.st_mode&0o077 or not 32<=s.st_size<=4098: raise ValueError()
   data=os.read(fd,4099); t=os.fstat(fd)
   if len(data)!=s.st_size: raise ValueError()
   if (s.st_ino,s.st_dev,s.st_uid,s.st_mode,s.st_size,s.st_mtime_ns,s.st_nlink)!=(t.st_ino,t.st_dev,t.st_uid,t.st_mode,t.st_size,t.st_mtime_ns,t.st_nlink): raise ValueError()
   value=data.decode('ascii').removesuffix('\n').removesuffix('\r')
   if not 32<=len(value)<=4096 or any(ord(c)<33 or ord(c)>126 for c in value): raise ValueError()
   values[name]=value
  finally: os.close(fd)
 os.environ.update(values)
 os.execv(sys.argv[2],sys.argv[2:])
except Exception:
 print('CREDENTIAL_ENV_EXEC_DENIED',file=sys.stderr);sys.exit(78)
`;export function credentialExecSpec(refs,binary,args){credentialReferencePaths(refs);if(!isAbsolute(binary)||!Array.isArray(args)||!args.every(x=>typeof x==='string'))throw Error('CREDENTIAL_EXEC_TARGET_DENIED');if(!Object.keys(refs||{}).length)return{argv:[binary,...args]};return{argv:['/usr/bin/python3','-c',credentialExecPython,JSON.stringify(refs),binary,...args]};}export function expandCredentialTemplate(value,env){if(typeof value!=='string')throw Error('CREDENTIAL_TEMPLATE_DENIED');const result=value.replace(/\{env:([^}]+)\}/g,(_,name)=>{if(!allowed.has(name)||!Object.hasOwn(env,name))throw Error('CREDENTIAL_REFERENCE_UNBOUND');return env[name];});if(/\{env:|\{file:|\$\{/.test(result))throw Error('CREDENTIAL_TEMPLATE_DENIED');return result;}
