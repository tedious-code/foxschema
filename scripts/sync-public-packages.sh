#!/usr/bin/env bash
#
# Mirror packages/core and packages/shared from this private monorepo
# (the source of truth) to their PUBLIC GitHub repos.
#
#   tedious-code/foxschema-shared  <-  packages/shared
#   tedious-code/foxschema-core    <-  packages/core
#
# History model: "fresh start" — each public repo carries its own initial
# commit plus one snapshot commit per sync. The monorepo keeps full history.
#
# Auth: uses the active `gh` account (must be a member of tedious-code with
# push rights). Run `gh auth status` to check which account is active.
#
# Usage:
#   ./scripts/sync-public-packages.sh             # mirror both
#   ./scripts/sync-public-packages.sh core        # mirror only core
#   ./scripts/sync-public-packages.sh shared      # mirror only shared
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ORG="tedious-code"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TOKEN="$(gh auth token)"
ACCOUNT="$(gh api user --jq .login)"
echo "Mirroring as gh account: $ACCOUNT"

git_auth() {
  # git with keychain helper disabled, using the active gh token
  git -c credential.helper= \
      -c credential.helper='!f() { echo username=x-access-token; echo "password='"$TOKEN"'"; }; f' \
      "$@"
}

sync_one() {
  local pkg="$1" repo="$2"
  local dir="$WORK/$pkg"
  echo "==> $pkg -> $ORG/$repo"

  # clone the existing public repo so we keep its history (just replace contents)
  git_auth clone -q "https://github.com/$ORG/$repo.git" "$dir"

  # wipe tracked files (keep .git) and re-copy the current package + license
  find "$dir" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
  rsync -a --exclude node_modules --exclude dist "$ROOT/packages/$pkg/" "$dir/"

  # carry over LICENSE/.gitignore if the package doesn't ship its own
  [ -f "$dir/LICENSE" ]    || cp "$ROOT/scripts/mirror-assets/LICENSE" "$dir/LICENSE" 2>/dev/null || true
  [ -f "$dir/.gitignore" ] || printf 'node_modules/\ndist/\n*.log\n.DS_Store\n' > "$dir/.gitignore"

  cd "$dir"
  git add -A
  if git diff --cached --quiet; then
    echo "    no changes — skipping"
    return
  fi
  git -c user.name="$ACCOUNT" -c user.email="huyplb@live.com" \
      commit -q -m "Sync @foxschema/$pkg from monorepo ($(date +%Y-%m-%d))"
  git_auth push -q origin HEAD:main
  echo "    pushed."
}

want="${1:-all}"
if [ "$want" = all ] || [ "$want" = shared ]; then sync_one shared foxschema-shared; fi
if [ "$want" = all ] || [ "$want" = core ];   then sync_one core   foxschema-core;   fi
echo "Done."
