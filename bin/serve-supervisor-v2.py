#!/usr/bin/env python3
"""Start pinned OpenCode v2; never emit its server-password startup line."""
import os,sys,subprocess,signal
from pathlib import Path
home=Path.home()
root=home/'.local/share/opencode-mcp'
validation='--validation' in sys.argv
base=root/'v2-validation'
env=os.environ.copy()
env['PATH']=str(home/'.local/bin')+':/usr/local/bin:/usr/bin:/bin'
password=(root/'runtime/opencode-password').read_text().strip()
env['OPENCODE_SERVER_PASSWORD']=password
env['OPENCODE_SERVER_USERNAME']='opencode'
if validation:
    for key,name in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_STATE_HOME','state'),('XDG_CACHE_HOME','cache')]:env[key]=str(base/name)
    env['OPENCODE_DB']=str(base/'data/opencode/opencode.db')
else:env['OPENCODE_DB']=str(home/'.local/share/opencode/opencode-v2.db')
binary=home/'.local/opt/opencode-2.0.32/package/bin/opencode'
child=subprocess.Popen([str(binary),'serve','--hostname','127.0.0.1','--port','14096' if validation else '4096'],env=env,cwd=base/'work' if validation else home,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
stopping=False
def stop(sig,frame):
    global stopping
    stopping=True
    if child.poll() is None:child.send_signal(sig)
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
for line in child.stdout:
    if 'password' in line.lower():continue
    sys.stdout.write(line.replace(password,'[REDACTED]'));sys.stdout.flush()
rc=child.wait()
sys.exit(0 if stopping else (rc if rc>=0 else 128-rc))
