#!/usr/bin/env bash
# Cloud Agent start: per-boot runtime state for FoxSchema.
#
# Docker is not available in the Cloud Agent VM, so the dockerized test
# databases (Postgres/MySQL/…) are out of scope here. The core compare/migrate
# engine is fully exercisable with file-based SQLite, so we seed the two demo
# SQLite databases into /tmp on every boot. This is idempotent (the seeder
# removes and recreates the files) and terminates.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "▶ Seeding SQLite demo databases …"
bash "$REPO/scripts/seed/seed-all.sh" sqlite

echo "✓ start complete"
