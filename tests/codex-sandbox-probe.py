import errno,json,os,socket,sys
root,port=sys.argv[1],int(sys.argv[2]);work=os.path.join(root,"work");checks=[]
assert open(os.path.join(work,"safe.txt")).read()=="SAFE_READ"
def denied(name,fn):
    try: fn()
    except OSError as e:
        assert e.errno in (errno.EPERM,errno.EACCES,errno.EROFS),(name,e.errno)
        checks.append({"operation":name,"denied":True,"errno":e.errno});return
    raise AssertionError(name+" unexpectedly allowed")
def create(path):
    with open(path,"w") as f: f.write("DENIED")
denied("workspace_create",lambda:create(os.path.join(work,"denied.txt")))
denied("workspace_append",lambda:open(os.path.join(work,"safe.txt"),"a").close())
denied("workspace_unlink",lambda:os.unlink(os.path.join(work,"safe.txt")))
denied("workspace_rename",lambda:os.rename(os.path.join(work,"safe.txt"),os.path.join(work,"moved.txt")))
denied("workspace_mkdir",lambda:os.mkdir(os.path.join(work,"denied-dir")))
denied("outside_create",lambda:create(os.path.join(root,"outside-denied.txt")))
s=None
try:
    s=socket.socket();s.settimeout(2);s.connect(("127.0.0.1",port))
except OSError as e: network={"blocked":True,"errno":e.errno,"socket_created":s is not None}
else: raise AssertionError("owned parent TCP endpoint reachable from sandbox")
finally:
    if s is not None:s.close()
status=dict(line.split(":",1) for line in open("/proc/self/status") if ":" in line)
print(json.dumps({"status":"PASS","read_only_file_tests":checks,"network":network,"uid_inside":os.getuid(),"no_new_privs":status.get("NoNewPrivs","").strip(),"seccomp":status.get("Seccomp","").strip(),"cap_eff":status.get("CapEff","").strip()}))
