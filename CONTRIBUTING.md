# Contributing to Fox

Thanks for your interest in improving Fox! New dialect support, bug fixes,
documentation, and tests are all especially welcome. This guide gets you from a
fresh clone to a running app with a passing test suite.

> Product name: **Fox**. Package/repo identity: **`foxschema`** (`@foxschema/*`) —
> both are intentional; don't "fix" one to match the other.

## Prerequisites

- **Node.js ≥ 22.5** (the app uses the built-in `node:sqlite`; Node 24 is what we
  develop on).
- **Docker** — for the test databases and the end-to-end suite.
- **Rust (stable)** — only if you build the desktop (Tauri) app.

## First-time setup

```bash
npm install                       # installs the whole workspace

# Start the 6 test databases (Postgres, MySQL, MariaDB, SQL Server, Oracle, Db2)
docker compose up -d
bash scripts/seed/seed-all.sh all # seed demo_a/demo_b schemas into each

npm run dev                       # Express API + Vite UI (single-user mode)
```

`npm run dev` serves the UI on **http://localhost:5173** and the API on **:3001**.
Connection details for the seeded databases are printed by `seed-all.sh` (all use
`foxuser` / `foxpass` except SQL Server/Oracle — see the script output).

For the advanced test schemas (`demo_c` / `demo_d` — FK chains, cross-dialect type
matrix, materialized views, etc.): `bash scripts/seed/seed-advanced.sh all`.

## Correctness gates (run before every PR)

```bash
cd apps/web && npx tsc --noEmit   # primary typecheck gate
npx vitest run                    # from the repo root — the unit test suite
```

Both must be green. For database-touching changes, also run the relevant slice of
the Playwright E2E suite (see below).

## Repository layout

| Workspace | What it is |
|-----------|------------|
| [`packages/core`](packages/core) | The dialect-agnostic engine: introspection, diff, migration generation/execution, and all 10 dialect providers. No browser dependencies. |
| [`apps/web`](apps/web) | Express API + React/Vite UI. Also the backend the desktop app runs. |
| [`apps/desktop`](apps/desktop) | Tauri v2 shell wrapping the web UI as a native app. See [docs/desktop-build.md](docs/desktop-build.md). |
| [`apps/cli`](apps/cli) | The `fox` terminal CLI + Ink TUI. |
| [`apps/e2e`](apps/e2e) | Playwright E2E tests against the dockerized databases. |

The design, the migration pipeline, and the dialect system are described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — read it before non-trivial changes.

## Running each surface

```bash
# Web (API + UI)
npm run dev
npm run dev:auth                  # multi-user + auth enabled

# CLI / TUI
cd apps/cli && npx tsx src/index.ts --help
cd apps/cli && npx tsx src/index.ts tui

# Desktop
cd apps/desktop && npm run dev

# E2E (one dialect, or all)
npm -w @foxschema/e2e run test:postgres
npm -w @foxschema/e2e run test:all
```

**E2E hard rule:** migrations mutate the target, so re-seed before every run — use
`bash scripts/seed/reset-all.sh` (full `down -v` + up + reseed). Re-running against a
mutated target accumulates corruption and produces false failures.

## Testing expectations

- Engine logic (compare, generator, providers) → unit tests in `packages/core`.
- CLI commands and the TUI → see the focused testing guides:
  [`apps/cli/src/commands/__tests__/README.md`](apps/cli/src/commands/__tests__/README.md)
  and [`apps/cli/src/tui/__tests__/README.md`](apps/cli/src/tui/__tests__/README.md)
  (they document the mock seams and some real timing gotchas).
- Real cross-dialect behavior → the E2E suite.

Add or update tests with your change; a PR that changes behavior without tests will
be asked for them.

## Adding a new SQL dialect

Each dialect is four small files under `packages/core/src/providers/<dialect>/`
(settings, adapter, provider, sql-dialect). The exact contract — required vs.
optional hooks, cross-cutting invariants (casing, index/FK naming, DROP ordering),
and per-dialect gotchas — is documented in
**[packages/core/src/providers/DIALECTS.md](packages/core/src/providers/DIALECTS.md)**,
with the step-by-step checklist in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Read `DIALECTS.md` before touching any `*.sql-dialect.ts` or `sql-generator.module.ts`.

## Conventions worth knowing

A few rules that have bitten people before (the full set is in [CLAUDE.md](CLAUDE.md)):

- **The compare key is not a SQL identifier.** `obj.tableName` is the uppercased
  match key from `compare.module.ts` — use `source?.name` / `targetTable?.name` for
  real DDL (native casing; case-sensitive on MySQL).
- **The app's metadata-DB migrations are append-only** — never edit a shipped
  migration in `apps/web/src/backend/database/schema.ts`; add a new one.
- **Never store database passwords client-side or in history.** Saved connections
  are encrypted server-side; only host/database/schema/port/username reach the browser.
- **Keep React hooks above any early `return`** (a rules-of-hooks crash has happened).
- **The frontend imports nothing from workspace packages** — it uses standalone copies
  in `apps/web/src/frontend/lib/`. Mirror `packages/core` changes there.

## Pull requests

1. Branch off `main`.
2. Keep the change focused; update docs and tests alongside code.
3. Ensure the correctness gates pass (`tsc --noEmit` + `vitest run`).
4. Write a clear PR description: what changed, why, and how you verified it.

Bug reports and feature ideas → open a GitHub issue. Security vulnerabilities →
**do not** open a public issue; follow [SECURITY.md](SECURITY.md).
