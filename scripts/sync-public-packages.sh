#!/usr/bin/env bash
#
# Mirror the publishable packages from this private monorepo
# (the source of truth) to their PUBLIC GitHub repos.
#
#   tedious-code/foxschema-shared  <-  packages/shared
#   tedious-code/foxschema-sql     <-  packages/sql
#   tedious-code/foxschema-db      <-  packages/db
#
# NOTE (core split): packages/core became packages/sql (pure) + packages/db
# (Node runtime). The target repos above must already exist — sync_one clones
# them and fails loudly if they do not. The old tedious-code/foxschema-core
# repo is no longer a sync target; decide whether to archive or repoint it.
#
# NOTE (dependency): packages/db declares "@foxschema/sql": "*". Mirrored on its
# own, that specifier only resolves once @foxschema/sql is published to npm.
# Publish sql first, or pin db to a real version before relying on the mirror.
#
# History model: "fresh start" — each public repo carries its own initial
# commit plus one snapshot commit per sync. The monorepo keeps full history.
#
# Auth: uses the active `gh` account (must be a member of tedious-code with
# push rights). Run `gh auth status` to check which account is active.
#
# Usage:
#   ./scripts/sync-public-packages.sh             # mirror all three
#   ./scripts/sync-public-packages.sh shared      # mirror only shared
#   ./scripts/sync-public-packages.sh sql         # mirror only sql
#   ./scripts/sync-public-packages.sh db          # mirror only db
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

  # The packages are this repository's own code, Apache-2.0 like the rest of
  # it (SPDX headers, package.json "license"). A package without its own
  # LICENSE gets the repository's. This used to copy an MIT file from
  # scripts/mirror-assets, which contradicted every header it shipped beside.
  [ -f "$dir/LICENSE" ]    || cp "$ROOT/LICENSE" "$dir/LICENSE"
  [ -f "$dir/NOTICE" ]     || { [ -f "$ROOT/NOTICE" ] && cp "$ROOT/NOTICE" "$dir/NOTICE"; } || true
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
case "$want" in
  all|shared|sql|db) ;;
  *) echo "Unknown package '$want' (expected: all, shared, sql, db)." >&2; exit 2 ;;
esac
if [ "$want" = all ] || [ "$want" = shared ]; then sync_one shared foxschema-shared; fi
if [ "$want" = all ] || [ "$want" = sql ];    then sync_one sql    foxschema-sql;    fi
if [ "$want" = all ] || [ "$want" = db ];     then sync_one db     foxschema-db;     fi
echo "Done."
