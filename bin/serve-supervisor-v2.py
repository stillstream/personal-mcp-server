#!/usr/bin/env python3
"""Start the configured OpenCode v2 HTTP server without leaking its password to logs."""
import os
import signal
import subprocess
import sys
from pathlib import Path

exe = os.environ.get("OPENCODE_CLI_BIN")
password_file = os.environ.get("OPENCODE_PASSWORD_FILE")
if not exe or not Path(exe).is_file() or not password_file:
    sys.exit("OpenCode executable or password file is not configured")

password = Path(password_file).read_text(encoding="utf-8").strip()
if not password:
    sys.exit("OpenCode password file is empty")
env = os.environ.copy()
env["OPENCODE_SERVER_PASSWORD"] = password
env["OPENCODE_SERVER_USERNAME"] = "opencode"
cmd = [
    exe, "serve", "--hostname", os.environ.get("OPENCODE_HOST", "127.0.0.1"),
    "--port", os.environ.get("OPENCODE_PORT", "4096"),
]
child = subprocess.Popen(
    cmd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    text=True, bufsize=1
)
stopping = False

def stop(sig, _frame):
    global stopping
    stopping = True
    if child.poll() is None:
        child.send_signal(sig)

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    for line in child.stdout:
        if "password" in line.lower():
            continue
        sys.stdout.write(line.replace(password, "[REDACTED]"))
        sys.stdout.flush()
finally:
    rc = child.wait()
sys.exit(0 if stopping else (rc if rc >= 0 else 128 - rc))
