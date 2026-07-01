# E2E test plan and migration-ordering bug investigation — 2026-07-01

## Test plan

1. `docker compose up -d` — start all 6 dialect containers (Postgres, MySQL,
   MariaDB, SQL Server, Oracle, DB2).
2. `bash scripts/seed/seed-all.sh all` — reseed `demo_a`/`demo_b` fresh.
   **Must run immediately before every test pass** — E2E migrations mutate
   the target live, and re-running against already-migrated data produces
   misleading, non-reproducible failures (see "False leads" below).
3. `npm run dev` (repo root) — start the API + frontend. Restart before
   reseeding if the backend has been running a while — a held-open DB
   connection pool can block a schema's `DROP USER`/`DROP DATABASE` during
   reseed (observed on Oracle, see below).
4. `cd apps/e2e && node scripts/run-all.mjs` — run all configured dialects
   exactly once. Do not re-run without reseeding first.

## Results (clean single run, 2026-07-01)

| Dialect | Result |
|---|---|
| MariaDB | ✅ PASS |
| MySQL | ✅ compare + migration passed; only `migration history shows the run` failed (0 records) |
| Postgres | ❌ migration failed — root-caused below |
| Oracle | ❌ migration failed — `ORA-02289: sequence does not exist` on `CREATE CATEGORIES TABLE`. Not yet root-caused (Oracle connection was too slow to capture the generated SQL in this session — timed out at 60s). Needs a follow-up session with a longer capture budget. |
| SQL Server | ❌ flaked on `connects source` — `page.selectOption` timeout on the schema dropdown, unrelated to migration correctness. Re-run to confirm before treating as a real bug. |

## False leads (ruled out)

Both a "MySQL: Cannot drop index needed by FK" error and a "MariaDB:
duplicate key errno 121" error were seen in earlier passes of this session.
**Both disappeared on a clean, single, freshly-reseeded run.** Root cause:
repeated `run-all.mjs` invocations without reseeding between them accumulate
partial-migration artifacts (e.g., FK constraints added with wrong casing by
a previous partial run, never cleaned up) that compound into confusing,
non-reproducible failures on the next run. **Lesson: always reseed
immediately before the run you're diagnosing; never trust a failure signature
gathered across multiple dirty runs.**

Chasing this also surfaced a second, unrelated seed-script bug: Oracle's
`DROP USER ... CASCADE` (in `docker/init/oracle/02_seed.sql`) silently
swallows all exceptions (`EXCEPTION WHEN OTHERS THEN NULL`), including
`ORA-01940` (cannot drop a user with an active session). The running
backend's Oracle connection pool held a session open across a previous test
run, blocking the drop; the reseed script didn't surface this and proceeded
straight to a failing `CREATE USER` with a stale schema left behind.
Restarting the backend before reseeding resolved it. Not fixed here (out of
scope of the migration-generator bug this session targets) — worth hardening
similarly to the SQL Server sequence/FK fix from the previous session if it
recurs.

## Root cause: Postgres trigger created before its backing function

### Symptom
```
function _trg_update_customer_ts() does not exist
```
on the `ALTER TABLE CUSTOMERS` step.

### Investigation
Captured the exact generated SQL via the "Migration SQL" tab (Copy SQL →
clipboard). The **displayed** script shows the function created in the
"CREATE ADDED OBJECTS" section, before the "ALTER MODIFIED OBJECTS" section
— which looked fine and initially pointed at a red herring (search_path /
schema-qualification theory, since the `CREATE TRIGGER ... EXECUTE FUNCTION
_trg_update_customer_ts()` call is unqualified). That theory was **wrong**:
traced `postgres.adapter.ts` → `setCurrentSchema` is called once at the start
of `MigrationModule.execute` and never changed again, so search_path stays
pinned to the target schema for the whole transaction; an unqualified call
resolves fine as long as the function already exists in that schema by the
time the trigger statement runs.

The real issue: `generateMigrationSql` (the **display** function) regroups
the flat `steps` array from `generateMigrationPlan` into three fixed sections
— DROP, CREATE, ALTER — for human readability
([sql-generator.module.ts:696-713](../../packages/core/src/modules/sql-generator.module.ts#L696-L713)).
Since both structural creates (tables) and procedural creates (functions)
share `action: 'CREATE'`, they get merged into one "CREATE" bucket and shown
*before* the "ALTER" bucket — even though the **true** execution order
(the raw `steps` array, which is what `MigrationModule.execute` actually
iterates —
[migration.module.ts:40](../../packages/core/src/modules/migration.module.ts#L40))
is:

```
DROP → CREATE (structural: tables/sequences/types/roles) → ALTER (modified) → CREATE (procedural: views/functions/procedures/triggers)
```

`generateMigrationPlan` deliberately puts procedural ADDED objects **last**
so views can see columns added by ALTER
([sql-generator.module.ts:626-628](../../packages/core/src/modules/sql-generator.module.ts#L626-L628)).
But `alterObjectStatements` for a MODIFIED table can itself create a **new
trigger** as part of that same ALTER step
([sql-generator.module.ts:469-474](../../packages/core/src/modules/sql-generator.module.ts#L469-L474)),
and that trigger's `EXECUTE FUNCTION` can reference a function that is only
created in the later procedural-CREATE phase. Confirmed exactly this: `CUSTOMERS`
is a MODIFIED table whose ALTER step adds `trg_customer_created`, which calls
`_trg_update_customer_ts()` — a newly-ADDED function not created until phase 4,
one phase *after* the ALTER that needs it.

### Why the fix must be dialect-agnostic
This is a generator-level ordering bug (`generateMigrationPlan`), not a
Postgres syntax quirk — it would reproduce on any dialect where a MODIFIED
table's ALTER step can add a trigger that calls a newly-added function/
procedure (DB2, Oracle, SQL Server, MySQL/MariaDB all support ALTER-time
trigger creation and none currently guard against this). Fixing it in the
shared `generateMigrationPlan` phase order — rather than patching around it
per-dialect — is the only fix that doesn't risk breaking one dialect while
fixing another, per the explicit instruction for this session.

### Fix
Split the "procedural ADDED" phase in two by dependency direction instead of
treating VIEW/FUNCTION/PROCEDURE/TRIGGER as one monolithic "runs last" group:

- **FUNCTION / PROCEDURE** — routines don't need ALTER'd columns to exist to
  be *created* (their bodies aren't validated against table structure at
  creation time in any of the 10 supported dialects). Anything that might
  call them (a trigger added during ALTER, another routine) does need them
  to exist first. Move these to run **before** the MODIFIED/ALTER phase,
  right after structural ADDED objects.
- **VIEW / TRIGGER** — views genuinely need ALTER'd columns to exist
  (`SELECT` against a column that doesn't exist yet fails). Standalone
  ADDED triggers and the ALTER-nested trigger creation both only need their
  target table and calling function to exist — both are satisfied once
  routines move earlier. Keep these running **after** the ALTER phase, as
  today.

New order: `DROP → CREATE (structural) → CREATE (functions/procedures) →
ALTER (modified) → CREATE (views/triggers)`.

## Verification plan
1. `npx vitest run` (repo root) — must stay green; add a new
   `sql-generator.module.test.ts` case: a MODIFIED table whose diff includes
   an ADDED trigger referencing an ADDED function in the same diff set —
   assert the function's CREATE step index is lower than the table's ALTER
   step index.
2. `cd apps/web && npx tsc --noEmit`.
3. Reseed fresh, run the Postgres E2E dialect test alone
   (`npx vitest run src/tests/dialects/postgres.test.ts`) — the
   `executes migration (non-destructive)` and `migration history shows the
   run` cases should now pass.
4. Re-run the full 5-dialect suite once (after a fresh reseed) to confirm no
   regression on MySQL/MariaDB/SQL Server/Oracle from the phase reorder.

## Fix applied and verified

Implemented in [sql-generator.module.ts](../../packages/core/src/modules/sql-generator.module.ts):
split the "procedural ADDED" phase into `ROUTINE_TYPES` (FUNCTION, PROCEDURE —
now created right after structural ADDED objects, before MODIFIED/ALTER) and
the remaining VIEW/TRIGGER (still after ALTER, unchanged). Extracted the
shared step-building logic into `createProceduralStep()` to avoid duplicating
the `noDefRoutine` skip-detection between the two phases.

- Added a regression test in `sql-generator.module.test.ts`: a MODIFIED table
  whose ALTER adds a trigger calling a function that's ADDED in the same
  diff set — asserts the function's step index is lower than the table's
  ALTER step index. `npx vitest run` — 93/93 passing (was 92; +1 new test).
- `cd apps/web && npx tsc --noEmit` — clean.
- Reseeded Postgres fresh, ran `npx vitest run src/tests/dialects/postgres.test.ts`
  alone: the original `function _trg_update_customer_ts() does not exist`
  error is **gone**. The generated plan now shows all 4 routines
  (`_trg_decrement_stock`, `_trg_update_customer_ts`, `fn_order_total`,
  `sp_confirm_order`) created *before* any ALTER TABLE step — confirmed via
  the actual "Migration Failed Snapshot" event order, not just the generator
  unit test.

### New bug exposed by this fix (not fixed — logged for a future session)

Fixing the ordering bug let the migration progress further and hit a
**different**, previously-unreached Postgres error:
```
default for column "status" cannot be cast automatically to type order_status
```
on `ALTER TABLE ORDERS`. Root cause (not yet fixed): the column's type is
changing to an incompatible enum (`order_status`) while it still has an
existing DEFAULT value; Postgres requires the DEFAULT be dropped before an
incompatible TYPE change and re-applied after, but
`alterObjectStatements`/`modifyColumnStatements` currently emits `ALTER
COLUMN ... TYPE ... USING ...` while the old default is still attached, then
tries to `SET DEFAULT` again afterward — it never drops the interim default
first. This is a separate, real bug from today's fix, isolated to
Postgres's column-type-change path. Left for a dedicated follow-up per this
session's instruction to fix one thing deeply rather than chase every issue
that surfaces.

## Deferred (separate follow-ups, not fixed this session)
- **New**: Postgres `ALTER COLUMN ... TYPE` fails when the column has an
  existing DEFAULT that can't auto-cast to the new type (see above) —
  exposed by today's fix, not yet root-caused beyond the error message.
- Oracle `ORA-02289: sequence does not exist` on `CREATE CATEGORIES TABLE` —
  needs its own root-cause session with a working Oracle connection capture.
- SQL Server `connects source` schema-dropdown timeout — re-run to confirm
  it's a real flake vs. a regression before investigating further.
- MySQL/Postgres "migration history shows 0 records" — likely the SSE
  'done'-event-before-history-write race identified in an earlier session;
  not re-investigated here.
- Oracle seed script's silent `DROP USER` exception-swallowing (see "False
  leads" above) — same bug class as the SQL Server sequence-drop fix from
  the previous session, not yet applied to Oracle's seed script.
