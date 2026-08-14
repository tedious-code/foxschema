#!/usr/bin/env bash
# Reseed local Docker Postgres (demo_a / demo_b) and run compare → migrate e2e.
# Lokee snapshots the target before and after, so History on demo_b has v1+v2.
#
# Requires: foxschema-postgres running, `npm run dev` on :5173 / :3210.
# Usage: bash scripts/e2e-postgres-history.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if ! curl -sf http://127.0.0.1:3210/api/health >/dev/null; then
  echo "API is not up on :3210. In another terminal: npm run dev"
  exit 1
fi
if ! curl -sf -o /dev/null http://127.0.0.1:5173/; then
  echo "UI is not up on :5173. In another terminal: npm run dev"
  exit 1
fi

if [ ! -f apps/e2e/.env ]; then
  cp apps/e2e/.env.example apps/e2e/.env
  echo "Wrote apps/e2e/.env from .env.example"
fi

echo "▶ Reseed Postgres demo_a / demo_b (needed so migrate has a diff)"
bash "$REPO/scripts/seed/seed-all.sh" postgres

echo "▶ Postgres compare → migrate → Lokee History"
npm run test:e2e:postgres

echo
echo "Open http://127.0.0.1:5173 → Compare Schema → History"
echo "Picker: POSTGRES · foxdb · demo_b  (target, not demo_a)"
echo "Expect 2 versions. fn_order_total = Source, no Table growth. customers = growth."
