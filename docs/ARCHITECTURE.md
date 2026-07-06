# Architecture reference

Stable orientation for FoxSchema. `CLAUDE.md` holds the must-follow rules and points
here for detail. For current state, gotchas, and pending work see `IMPLEMENTATION_STATE.md`.

## What this is

Database schema **diff & migration** tool. Compare a source schema against a target,
generate dialect-native migration SQL, and deploy it. Primary target is DB2; Postgres,
MySQL, SQL Server, Oracle, SQLite, MariaDB, Azure SQL, ClickHouse, and Redshift are also
implemented. Two distributions: **desktop** (Tauri v2) and **web** (self-hosted Express + React).

## Commands

```bash
# Development (starts both Express API + Vite frontend)
npm run dev                          # single-user mode (no login)
npm run dev:auth                     # multi-user auth mode

# Typecheck — primary correctness gate
cd apps/web && npx tsc --noEmit

# Tests — run from repo root (covers packages/* and apps/web/**/*.test.ts)
npx vitest run                       # all tests
npx vitest run packages/core         # core engine tests only
npx vitest run --reporter=verbose    # with test names
npx vitest <pattern>                 # e.g. npx vitest sql-generator

# Desktop
cd apps/desktop && npm run dev       # builds sidecar then launches Tauri

# CLI (development)
cd apps/cli && npm run dev -- compare --source ... --target ...
```

Backend changes (`apps/web/src/backend`, `packages/core`) hot-reload via `tsx watch`.
Desktop sidecar requires `cd apps/desktop && npm run dev` after any backend change.

## E2E tests (apps/e2e)

Playwright + Vitest against 6 Docker dialect containers. See the E2E workflow memory and
`docs/plans/2026-07-01-seed-test-matrix.md` for the operational details (reseed before
every run, restart backend before reseeding Oracle/DB2, DB2 `/var/custom` init).

```bash
# One-command reset: compose up + wait healthy + restart dev + reseed
bash scripts/seed/reset-all.sh
bash scripts/seed/seed-all.sh all    # reseed only

# Run the suite (dev server must be up)
cd apps/e2e && node scripts/run-all.mjs
```

## Repo layout

npm workspaces — not pnpm or Turborepo.

```
packages/core/          @foxschema/core — engine (no browser deps)
  src/interfaces/       TableSchema, TableDiff, ColumnDiff, MigrationStep, etc.
  src/modules/          CompareModule, SqlGeneratorModule, ConnectionModule, MigrationModule
  src/providers/        10 dialects — each has settings + adapter + provider + sql-dialect
  src/cores/            ConnectionFactory, crypto, connection-string helpers

apps/web/
  src/backend/          Express API (routes, auth, migration history, metadata DB)
    database/stores/    Metadata DB providers: sqlite (default), postgres, mysql
  src/frontend/
    lib/                Browser-safe copies: types.ts, sql-generator.ts, provider-settings.ts
    store/              Zustand: useSyncStore.ts + sync-types.ts + sync-helpers.ts
    components/         UI components (SchemaTreePanel, ObjectDetailPanel, TopToolbar, …)
    components/object-detail/  MigrationProgressPanel, DeployConfirmDialog, DependencyWarningDialog

apps/desktop/           Tauri v2 shell + Node sidecar packaging
apps/cli/               Terminal CLI (commander; M4 TUI not yet started)
```

**Frontend imports nothing from workspace packages** — it uses standalone copies in
`apps/web/src/frontend/lib/`. Accepted duplication to avoid bundler complications.

## How a migration runs

1. **Compare** (server-side): `POST /api/compare` → `CompareModule.compare()` → `TableDiff[]`
2. **Generate** (client-side): `SqlGeneratorModule.generateMigrationPlan(diffs, targetDialect, mapping)`
   → `MigrationStep[]`. Runs in the browser on every selection toggle — no round-trip.
3. **Execute** (server-side): `POST /api/migration/execute` → `MigrationModule` streams
   `MigrationEvent` objects via SSE back to `MigrationProgressPanel`.

`SchemaMapping` threads through generation: `sourceSchema`, `targetSchema`, `sourceDialect`,
`targetDialect`, `nonDestructive`, `targetServerVersion`.

## Dialect system

Each of the 10 dialects has three layers registered in `packages/core/src/providers/`:

| File | Interface | Registry |
|------|-----------|----------|
| `<d>.settings.ts` | `ProviderConnectionSettings` | `provider-settings.ts` |
| `<d>.adapter.ts` | `DriverAdapter` | `adapter-registry.ts` |
| `<d>.provider.ts` | `SchemaProvider` | `provider-registry.ts` |

Plus `<d>.sql-dialect.ts` implementing `SqlDialect` — registered in `dialect-registry.ts`.

The `SqlDialect` interface has optional hooks; the generator uses a generic fallback when a
hook is absent. Adding dialect-specific behavior = implement the hook in that dialect's file
only. Key hooks: `dropForeignKeyStatement`, `dropIndexStatement`, `dropTriggerStatement`,
`createTriggerStatement`, `preDropTableStatements`, `createViewStatement`, `alterViewStatement`,
`wrapCreateSequence`, `dropTableStatement`, `dropViewStatement`, `dropSequenceStatement`,
`dropFunctionStatement`, `dropProcedureStatement`. Full hook map + fallback behavior +
per-dialect gotchas live in `packages/core/src/providers/DIALECTS.md`.

Version-aware DDL: `SchemaProvider.detectVersion?()` → stored in Zustand as
`targetServerVersion` → flows into `SchemaMapping` → dialect drop hooks use it. Oracle pre-23c
uses PL/SQL exception blocks; DB2 (all versions) uses SQL PL `CONTINUE HANDLER FOR SQLSTATE '42704'`.

## Frontend store structure

`useSyncStore.ts` (Zustand) is split across three files:
- `sync-types.ts` — `SyncState` interface, `MigrationProgressItem`, `ConnectionConfig`
- `sync-helpers.ts` — `buildRef`, `buildMapping`, `buildIncludedDiffs`, `regenerateSql`,
  shared `sqlGeneratorModule` instance
- `useSyncStore.ts` — the store implementation

`regenerateSql` is called on every selection toggle; it runs `SqlGeneratorModule`
synchronously in the browser. `applyMigration` sends the full `MigrationStep[]` plan to the
backend and streams results back via SSE.

## Adding a dialect (checklist)

1. Create the four files in `packages/core/src/providers/<name>/`
2. Register in `provider-settings.ts`, `adapter-registry.ts`, `provider-registry.ts`, `dialect-registry.ts`
3. Also update `apps/web/src/frontend/lib/provider-settings.ts` (frontend copy)
4. Add `parseType`/`renderType` round-trip tests in `type-mapping.test.ts`
5. Verify each optional hook against real DDL — the generic fallbacks are often wrong for DROP INDEX/TRIGGER/FK
6. `npx vitest run` + `cd apps/web && npx tsc --noEmit`
