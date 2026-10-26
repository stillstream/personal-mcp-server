#!/usr/bin/env python3
"""Descriptor-relative file operations; no-follow each component; never invoke shell."""
import os,sys,json,stat,fnmatch,ctypes

TEXT_EXTENSIONS={'.txt','.md','.json','.yaml','.yml','.toml','.csv','.xml','.html','.css','.js','.mjs','.ts','.tsx','.jsx','.py','.sh','.log','.c','.cpp','.h','.hpp'}
def search_tree(fd,base,action,a):
 results=[]; count={'entries':0,'files':0,'bytes':0,'truncated':False}; limit=a.get('max_results',50); pattern=a.get('pattern','*'); query=a.get('query','')
 if not isinstance(limit,int) or not 1<=limit<=100 or not isinstance(pattern,str) or len(pattern)>256: raise ValueError('SEARCH_ARGUMENT_DENIED')
 if action=='search_text' and (not isinstance(query,str) or not 1<=len(query)<=256): raise ValueError('SEARCH_QUERY_REQUIRED')
 def walk(d,prefix,depth):
  if depth>12: count['truncated']=True; return
  with os.scandir(d) as entries:
   for entry in entries:
    if count['entries']>=10000 or count['files']>=1000 or count['bytes']>=4194304 or len(results)>=limit: count['truncated']=True; return
    count['entries']+=1; name=entry.name
    if name.startswith('.') and not a.get('include_hidden',False): continue
    path='/'.join(x for x in (prefix,name) if x)
    try:
     s=os.stat(name,dir_fd=d,follow_symlinks=False)
     if stat.S_ISDIR(s.st_mode):
      child=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=d)
      try: walk(child,path,depth+1)
      finally: os.close(child)
     elif stat.S_ISREG(s.st_mode) and s.st_nlink==1:
      count['files']+=1
      if not fnmatch.fnmatchcase(name,pattern): continue
      if action=='search_files': results.append({'path':path,'size':s.st_size}); continue
      if os.path.splitext(name)[1].lower() not in TEXT_EXTENSIONS or s.st_size>262144: continue
      f=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=d)
      try:
       live=os.fstat(f)
       if not stat.S_ISREG(live.st_mode) or live.st_nlink!=1 or live.st_size>262144: continue
       data=os.read(f,min(262144,4194304-count['bytes'])); count['bytes']+=len(data)
       if len(data)<live.st_size: count['truncated']=True
      finally: os.close(f)
      for lineno,line in enumerate(data.decode('utf-8',errors='replace').splitlines(),1):
       if query in line:
        pos=line.index(query); start=max(0,pos-160)
        results.append({'path':path,'line':lineno,'column':pos+1,'text':line[start:start+1000]})
        if len(results)>=limit: count['truncated']=True; break
    except OSError: continue
 walk(fd,base,0)
 return {'matches':results,**count,'limits':{'depth':12,'entries':10000,'files':1000,'total_bytes':4194304,'file_bytes':262144,'results':limit}}

def perform(q):
 roots=q['roots']; a=q['args']; action=q['action']; root=a.get('root')
 if root not in roots: raise ValueError('ROOT_DENIED')
 path=a.get('path','.')
 if not isinstance(path,str) or path.startswith('/') or '\x00' in path: raise ValueError('PATH_DENIED')
 parts=path.split('/')
 if any(p in ('..','') for p in parts): raise ValueError('PATH_DENIED')
 parts=[p for p in parts if p!='.']
 flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
 fd=os.open(roots[root],flags)
 try:
  for part in parts[:-1]:
   nxt=os.open(part,flags,dir_fd=fd); os.close(fd); fd=nxt
  leaf=parts[-1] if parts else '.'
  if action in ('write','delete','mkdir','edit','rename') and not parts: raise ValueError('ROOT_MUTATION_DENIED')
  if action=='rename':
   target=a.get('destination'); dest=None
   if not isinstance(target,str) or target.startswith('/') or '\x00' in target: raise ValueError('DESTINATION_DENIED')
   dp=target.split('/')
   if any(x in ('..','') for x in dp): raise ValueError('DESTINATION_DENIED')
   dp=[x for x in dp if x!='.']
   if not dp: raise ValueError('ROOT_MUTATION_DENIED')
   src=os.open(leaf,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
   try:
    s=os.fstat(src)
    if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1: raise ValueError('SPECIAL_OR_LINK_DENIED')
    dest=os.open(roots[root],flags)
    for part in dp[:-1]:
     nxt=os.open(part,flags,dir_fd=dest);os.close(dest);dest=nxt
    libc=ctypes.CDLL(None,use_errno=True);move=libc.renameat2;move.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];move.restype=ctypes.c_int
    if move(fd,os.fsencode(leaf),dest,os.fsencode(dp[-1]),1)!=0: raise OSError(ctypes.get_errno(),'RENAME_DENIED')
    return {'renamed':True,'destination':target}
   finally:
    os.close(src)
    if dest is not None:os.close(dest)
  if action=='mkdir': os.mkdir(leaf,0o700,dir_fd=fd); return {'created':True}
  if action=='delete':
   st=os.stat(leaf,dir_fd=fd,follow_symlinks=False)
   if stat.S_ISDIR(st.st_mode): os.rmdir(leaf,dir_fd=fd)
   elif stat.S_ISREG(st.st_mode) and st.st_nlink==1: os.unlink(leaf,dir_fd=fd)
   else: raise ValueError('SPECIAL_OR_LINK_DENIED')
   return {'deleted':True}
  if action=='list':
   d=os.open(leaf,flags,dir_fd=fd)
   try: return {'entries':sorted(os.listdir(d))[:500]}
   finally: os.close(d)
  if action in ('search_files','search_text'):
   d=os.open(leaf,flags,dir_fd=fd)
   try: return search_tree(d,'/'.join(parts),action,a)
   finally: os.close(d)
  if action=='info':
   st=os.stat(leaf,dir_fd=fd,follow_symlinks=False)
   if stat.S_ISLNK(st.st_mode): raise ValueError('LINK_DENIED')
   return {'size':st.st_size,'mode':stat.S_IMODE(st.st_mode),'directory':stat.S_ISDIR(st.st_mode)}
  f=os.open(leaf,os.O_NOFOLLOW|os.O_NONBLOCK|(os.O_RDWR|os.O_CREAT if action=='write' else os.O_RDWR if action=='edit' else os.O_RDONLY),0o600,dir_fd=fd)
  try:
   st=os.fstat(f)
   if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1: raise ValueError('SPECIAL_OR_LINK_DENIED')
   if action in ('read','edit'):
    if st.st_size>1048576: raise ValueError('SIZE_LIMIT')
    text=os.read(f,1048577).decode('utf-8')
    if action=='read': return {'text':text}
    old=a['old_string']; new=a['new_string']
    if not old or text.count(old)!=1: raise ValueError('EDIT_MATCH_NOT_UNIQUE')
    data=text.replace(old,new).encode()
   elif action=='write': data=a['text'].encode()
   else: raise ValueError('ACTION_DENIED')
   if len(data)>1048576: raise ValueError('SIZE_LIMIT')
   os.lseek(f,0,0); os.ftruncate(f,0)
   with os.fdopen(os.dup(f),'wb') as out: out.write(data); out.flush(); os.fsync(out.fileno())
   return {'written':len(data)}
  finally: os.close(f)
 finally: os.close(fd)
try:
 q=json.load(sys.stdin); result=perform(q); print(json.dumps({'ok':True,'result':result}))
except Exception as e:
 print(json.dumps({'ok':False,'code':str(e) if isinstance(e,ValueError) else type(e).__name__})); sys.exit(1)
