#!/usr/bin/env bash
# Bundle one exact commit. Includes tracked source/history only, never instance state or credentials.
set -euo pipefail
ref="${1:?verified commit required}"; outdir="${2:?output directory required}"
repo="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
commit="$(git -C "$repo" rev-parse --verify --end-of-options "$ref^{commit}")"
refname="$(git -C "$repo" rev-parse --verify --symbolic-full-name --end-of-options "$ref")"
tag=""
[[ "$refname" != refs/tags/* ]] || tag="${refname#refs/tags/}"
umask 077; mkdir -p "$outdir"; outdir="$(realpath "$outdir")"
base="agent-mcp-$commit"; bundle="$outdir/$base.bundle"; manifest="$outdir/$base.manifest.json"; checksum="$outdir/$base.sha256"
[[ ! -e "$bundle" && ! -e "$manifest" && ! -e "$checksum" ]] || { echo 'artifact already exists; refusing overwrite' >&2; exit 2; }
stage="$(mktemp -d "$outdir/.bundle-XXXXXX")"; trap 'rm -rf -- "$stage"' EXIT
git -c init.defaultBranch=release init --bare "$stage/repo.git" >/dev/null
git --git-dir="$stage/repo.git" -c core.hooksPath=/dev/null fetch --no-tags "$repo" "$commit:refs/heads/release" >/dev/null
refs=(refs/heads/release)
if [[ -n "$tag" ]]; then
 git --git-dir="$stage/repo.git" -c core.hooksPath=/dev/null fetch --no-tags "$repo" "$refname:$refname" >/dev/null
 [[ "$(git --git-dir="$stage/repo.git" rev-parse --verify "$refname^{commit}")" = "$commit" ]] || { echo 'tag changed during packaging' >&2; exit 2; }
 refs+=("$refname")
fi
git --git-dir="$stage/repo.git" bundle create "$stage/source.bundle" "${refs[@]}"
git --git-dir="$stage/repo.git" bundle verify "$stage/source.bundle" >/dev/null
python3 - "$commit" "$tag" > "$stage/manifest.json" <<'PY'
import json,sys
print(json.dumps({"commit":sys.argv[1],"tag":sys.argv[2] or None,"branch":"release","contains":"tracked source and history only","acceptance":"Package creation is not full acceptance; see docs/ACCEPTANCE.md","requires":"Node >=22.19, Python3, Docker CLI/user daemon; optional backends per docs"}))
PY
ln "$stage/source.bundle" "$bundle"; ln "$stage/manifest.json" "$manifest"
(cd "$outdir"; sha256sum "$base.bundle" "$base.manifest.json") > "$stage/checksum"
ln "$stage/checksum" "$checksum"
printf 'bundle=%s\nmanifest=%s\nchecksum=%s\ncommit=%s\n' "$bundle" "$manifest" "$checksum" "$commit"
echo 'No credentials or instance state copied. No remote upload or deployment performed.'
