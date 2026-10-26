#!/usr/bin/env bash
set -euo pipefail
root="${1:?absolute new private build root required}"
[[ "$root" = /* && ! -e "$root" ]] || { echo NEW_PRIVATE_BUILD_ROOT_REQUIRED >&2; exit 2; }
umask 077; mkdir -m 700 "$root"; cd "$root"
curl -fsS --max-time 60 -o haproxy-2.8.16.tar.gz https://www.haproxy.org/download/2.8/src/haproxy-2.8.16.tar.gz
printf "%s  %s\n" 6eb4d3cc298af89613fc6cb175530436e1e463d368e43401a60357a7a12d15ab haproxy-2.8.16.tar.gz | sha256sum -c -
# Keep data filtering; skip nonregular test fixtures rather than following archive links.
python3 -c 'import tarfile;t=tarfile.open("haproxy-2.8.16.tar.gz");t.extractall("source",members=[m for m in t if m.isfile() or m.isdir()],filter="data")'
cd source/haproxy-2.8.16
# Model routes are explicitly HTTP; no Lua/TLS/systemd/PCRE dependency or OS package change.
make -j2 TARGET=linux-glibc USE_OPENSSL= USE_LUA= USE_PCRE2= USE_ZLIB= USE_SYSTEMD= > "$root/build.log" 2>&1
./haproxy -v
sha256sum ./haproxy
printf "Prepared only; no service started: %s\n" "$root/source/haproxy-2.8.16/haproxy"
