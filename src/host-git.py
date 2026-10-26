#!/usr/bin/env python3
"""Copy bounded descriptor-checked cwd; run fixed Git queries in a no-write/no-network kernel domain."""
import os,sys,json,stat,tempfile,shutil,subprocess,selectors,time,signal

def perform(q):
 a=q['args'];base=q['roots'].get(a.get('root'));path=a.get('path','.')
 if not base or not isinstance(path,str) or path.startswith('/') or '\0' in path or any(p in ('','..') for p in path.split('/')):raise ValueError('GIT_ROOT_PATH_DENIED')
 flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
 if not isinstance(base,str) or not base.startswith('/') or any(p in ('.','..') for p in base.split('/')):raise ValueError('GIT_ROOT_PATH_DENIED')
 fd=os.open('/',flags)
 for part in base.split('/'):
  if not part:continue
  n=os.open(part,flags,dir_fd=fd);os.close(fd);fd=n
 try:
  for part in path.split('/'):
   if part=='.':continue
   n=os.open(part,flags,dir_fd=fd);os.close(fd);fd=n
  scratch=q['scratch'];s=os.lstat(scratch)
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077:raise ValueError('PRIVATE_GIT_SCRATCH_REQUIRED')
  guard=q['guard'];g=os.lstat(guard)
  if not stat.S_ISREG(g.st_mode) or g.st_uid!=os.getuid() or g.st_mode&0o022 or g.st_nlink!=1:raise ValueError('GIT_GUARD_UNTRUSTED')
  target=tempfile.mkdtemp(prefix='query-',dir=scratch);count={'entries':0,'bytes':0};deadline=time.monotonic()+8
  try:
   def copy(d,out,depth):
    if depth>32:raise ValueError('GIT_SNAPSHOT_LIMIT')
    with os.scandir(d) as entries:
     for e in entries:
      count['entries']+=1
      if count['entries']>20000 or time.monotonic()>deadline:raise ValueError('GIT_SNAPSHOT_LIMIT')
      st=os.stat(e.name,dir_fd=d,follow_symlinks=False);dest=os.path.join(out,e.name)
      if stat.S_ISDIR(st.st_mode):
       child=os.open(e.name,flags,dir_fd=d)
       try:os.mkdir(dest,0o700);copy(child,dest,depth+1)
       finally:os.close(child)
      elif stat.S_ISREG(st.st_mode):
       f=os.open(e.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=d)
       try:
        before=os.fstat(f)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1:raise ValueError('GIT_LINK_OR_SPECIAL_DENIED')
        with open(dest,'xb') as w:
         while True:
          data=os.read(f,65536)
          if not data:break
          count['bytes']+=len(data)
          if count['bytes']>134217728 or time.monotonic()>deadline:raise ValueError('GIT_SNAPSHOT_LIMIT')
          w.write(data)
        os.chmod(dest,stat.S_IMODE(before.st_mode)&0o777)
        after=os.fstat(f)
        if (before.st_size,before.st_mtime_ns,before.st_nlink)!=(after.st_size,after.st_mtime_ns,after.st_nlink):raise ValueError('GIT_SNAPSHOT_CHANGED')
       finally:os.close(f)
      else:raise ValueError('GIT_LINK_OR_SPECIAL_DENIED')
   copy(fd,target,0)
   rules=[guard,'--read',target,'--read','/usr/lib','--read','/etc/ld.so.cache','--write','/dev/null','--exec','/lib64/ld-linux-x86-64.so.2','--exec','/usr/bin/git','--']
   prefix=['/usr/bin/git','--no-pager','--no-optional-locks','--literal-pathspecs','-c','safe.directory=*','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.attributesFile=/dev/null','-c','color.ui=false']
   env={'PATH':'/usr/bin:/bin','HOME':'/nonexistent','LANG':'C.UTF-8','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null','GIT_OPTIONAL_LOCKS':'0','GIT_TERMINAL_PROMPT':'0','GIT_ATTR_NOSYSTEM':'1'}
   def query(args):
    p=subprocess.Popen(rules+prefix+args,cwd=target,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True);sel=selectors.DefaultSelector();buffers={};truncated=False;end=time.monotonic()+5
    for stream in [p.stdout,p.stderr]:sel.register(stream,selectors.EVENT_READ);buffers[stream]=bytearray()
    try:
     while sel.get_map():
      if time.monotonic()>end:raise ValueError('GIT_QUERY_TIMEOUT')
      for key,_ in sel.select(0.1):
       data=os.read(key.fileobj.fileno(),65536)
       if not data:sel.unregister(key.fileobj);continue
       b=buffers[key.fileobj];remaining=max(0,131072-len(b));b.extend(data[:remaining]);truncated|=len(data)>remaining
     code=p.wait(timeout=1)
     return {'stdout':buffers[p.stdout].decode('utf-8',errors='replace'),'exit_code':code,'truncated':truncated}
    finally:
     sel.close()
     if p.returncode is None:
      try:os.killpg(p.pid,signal.SIGKILL)
      except ProcessLookupError:pass
     p.wait();p.stdout.close();p.stderr.close()
   result={}
   for name,args in [('status',['status','--porcelain=v1','--untracked-files=normal','--ignore-submodules=all']),('stat',['diff','--no-ext-diff','--no-textconv','--ignore-submodules=all','--stat']),('patch',['diff','--no-ext-diff','--no-textconv','--ignore-submodules=all','--']),('log',['log','-10','--format=%h %s'])]:result[name]=query(args)
   return {'queries':result,'business_diff_verified':all(x['exit_code']==0 for x in result.values()),'snapshot':count,'snapshot_scope':'bounded private copied cwd; links/special files rejected; concurrent changes may reject','readonly':True,'network':'denied'}
  finally:shutil.rmtree(target)
 finally:os.close(fd)
try:
 result=perform(json.load(sys.stdin));print(json.dumps({'ok':True,'result':result}))
except Exception as e:
 print(json.dumps({'ok':False,'code':str(e) if isinstance(e,ValueError) else type(e).__name__}));sys.exit(1)
