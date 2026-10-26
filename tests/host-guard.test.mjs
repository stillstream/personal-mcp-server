import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,symlink,open}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{spawn,execFile}from'node:child_process';import{promisify}from'node:util';import net from'node:net';
const exec=promisify(execFile),root=await mkdtemp(join(tmpdir(),'agent-mcp-kernel-')),bin=join(root,'guard');await exec('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',resolve('src/host-guard.c'),'-o',bin]);
async function listen(){const server=net.createServer(s=>s.end('ACK'));await new Promise(r=>server.listen(0,'127.0.0.1',r));return{server,port:server.address().port};}
test('real kernel boundary denies outside files exec Unix socket unsafe syscalls and inherited descriptors',async()=>{
 const allowed=join(root,'allowed'),outside=join(root,'outside'),ro=join(root,'readonly');await mkdir(allowed);await mkdir(outside);await mkdir(ro);await writeFile(join(outside,'secret'),'SYNTHETIC_DO_NOT_READ');await writeFile(join(ro,'read'),'READ_OK');await symlink(join(outside,'secret'),join(allowed,'escape'));const good=await listen(),bad=await listen(),unixPath=join(allowed,'outside.sock'),unix=net.createServer(s=>s.end('EXTERNAL'));await new Promise(r=>unix.listen(unixPath,r));let unixConnections=0;unix.on('connection',()=>unixConnections++);let deniedConnections=0;bad.server.on('connection',()=>deniedConnections++);const dummy=spawn('/usr/bin/python3',['-c','import time;time.sleep(60)'],{stdio:'ignore'}),extra=await open(join(outside,'secret'),'r');
 const code=[
 'import os,sys,json,socket,subprocess,ctypes,signal',
 'allowed,outside,ro,good,bad,dummy,unixpath=sys.argv[1:]; good,bad,dummy=map(int,[good,bad,dummy]); checks={}',
 'def denied(name,fn):',
 ' try: fn()',
 ' except (PermissionError,OSError) as e:',
 '  assert e.errno in ([1,9,13,18] if name=="hardlink_escape" else [1,9,13,22,104,106,107] if name.startswith("pair_") else [1,9,13]),(name,e.errno); checks[name]=True; return',
 ' raise AssertionError(name+" unexpectedly permitted")',
 'assert open(ro+"/read").read()=="READ_OK"',
 'open(allowed+"/ok","w").write("WRITE_OK")',
 'denied("outside_read",lambda:open(outside+"/secret").read())',
 'denied("outside_write",lambda:open(outside+"/new","w"))',
 'denied("readonly_write",lambda:open(ro+"/read","w"))',
 'denied("symlink_escape",lambda:open(allowed+"/escape").read())',
 'denied("hardlink_escape",lambda:os.link(outside+"/secret",allowed+"/hard"))',
 'denied("bash_exec",lambda:subprocess.run(["/bin/bash","-c","true"],check=True))',
 'denied("docker_exec",lambda:subprocess.run(["/usr/bin/docker","version"],check=True))',
 'denied("unix_socket",lambda:socket.socket(socket.AF_UNIX,socket.SOCK_STREAM))',
 'denied("datagram_socketpair",lambda:socket.socketpair(socket.AF_UNIX,socket.SOCK_DGRAM))',
 'a,b=socket.socketpair();a.send(b"IPC");assert b.recv(3)==b"IPC";a.close();b.close()',
 'def pair_escape(mode):',
 ' a,b=socket.socketpair()',
 ' try:',
 '  if mode=="shutdown":a.shutdown(socket.SHUT_RDWR)',
 '  if mode=="close":b.close()',
 '  if mode=="unspec":',
 '   v=ctypes.c_ushort(socket.AF_UNSPEC);ctypes.CDLL(None).connect(a.fileno(),ctypes.byref(v),2)',
 '  a.connect(unixpath)',
 ' finally:a.close();b.close()',
 'for mode in ["shutdown","close","unspec"]:denied("pair_"+mode,lambda mode=mode:pair_escape(mode))',
 'denied("raw_socket",lambda:socket.socket(socket.AF_INET,socket.SOCK_RAW))',
 'denied("udp_socket",lambda:socket.socket(socket.AF_INET,socket.SOCK_DGRAM))',
 'denied("inherited_fd",lambda:os.read(3,16))',
 'denied("external_signal",lambda:os.kill(dummy,signal.SIGUSR1))',
 's=socket.socket();s.settimeout(2);s.connect(("127.0.0.1",good));assert s.recv(3)==b"ACK";s.close()',
 'denied("nonlisted_tcp",lambda:socket.create_connection(("127.0.0.1",bad),timeout=2))',
 'lib=ctypes.CDLL(None,use_errno=True);assert lib.prctl(39,0,0,0,0)==1',
 'for nr in [272,308,425,438,321]:',
 ' assert lib.syscall(nr,0,0,0,0,0,0)==-1 and ctypes.get_errno()==1,nr',
 'child=subprocess.run([sys.executable,"-c","import sys;open(sys.argv[1]).read()",outside+"/secret"],capture_output=True);assert child.returncode!=0',
 'print(json.dumps({"checks":checks,"uid":os.getuid(),"child_restrictions_inherited":True,"no_new_privs":True}))'
 ].join('\n');
 try{const args=['--read','/usr/lib','--read','/etc/ld.so.cache','--read','/dev/null','--read',ro,'--write',allowed,'--exec','/lib64/ld-linux-x86-64.so.2','--exec','/usr/bin/python3','--connect',String(good.port),'--','/usr/bin/python3','-I','-S','-c',code,allowed,outside,ro,String(good.port),String(bad.port),String(dummy.pid),unixPath];const output=await new Promise((resolve,reject)=>{const p=spawn(bin,args,{stdio:['ignore','pipe','pipe',extra.fd]});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',c=>c===0?resolve(out):reject(Error('GUARD_TEST_EXIT_'+c+' '+err)));});const j=JSON.parse(output);assert.equal(Object.keys(j.checks).length,17);assert.equal(await readFile(join(allowed,'ok'),'utf8'),'WRITE_OK');assert.equal(await readFile(join(ro,'read'),'utf8'),'READ_OK');assert.equal(deniedConnections,0);assert.equal(unixConnections,0);assert.equal(dummy.exitCode,null);console.log(JSON.stringify({kernel_boundary:'PASS',...j}));}finally{await extra.close();dummy.kill();good.server.close();bad.server.close();unix.close();}
});
