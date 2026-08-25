# Backend architecture — state, decisions, and what to do next

Written for whoever picks this up next, human or agent. It records what the
backend *is*, why it is that way, and which of the plan's ideas were tried and
rejected — so the same ground is not re-covered.

Companion to `IMPLEMENTATION_STATE.md` (feature-level handoff) and
`docs/ARCHITECTURE.md` (repo layout, dialect system).

---

## 1. The package split, and what it maps to

The reference plan proposes `api / core / database / shared`. This repo already
has an equivalent split under different names, enforced by
`packages/sql/src/purity.test.ts`:

| Plan | This repo | Contains |
|---|---|---|
| `@foxschema/core` | `@foxschema/sql` | Dialect knowledge, compare, SQL generation, access model. **Zero deps, no Node built-ins.** |
| `@foxschema/database` | `@foxschema/db` | Drivers, pools, connection factory, circuit breaker. Depends on `sql`. |
| `@foxschema/api` | `apps/web/src/backend` | HTTP, auth, routes. |
| `@foxschema/shared` | — | Not separate; shared types live in `sql`. |

**The dependency rule is one-way and tested**: `sql` never imports `db`; the
frontend imports `sql` only, and importing `db` from the frontend fails the Vite
build deliberately. Neither package imports Fastify or Express.

Do not "fix" this by renaming packages to match the plan. The names differ; the
architecture does not.

---

## 2. HTTP: two servers, Express is still the default

`FOX_SERVER=fastify` selects the Fastify edge (`api/fastify-server.ts`);
anything else uses Express (`api/server.ts`). Both mount the same Express
router, so behaviour is identical.

### Why Fastify is not yet the default

Measured, 50 concurrent keep-alive connections, load generator in its **own
process**:

```
fastify, no express bridge     53474 req/s   p50 0.82ms   p99 2.50ms
express                        15209 req/s   p50 2.80ms   p99 9.15ms
fastify + express bridge        6786 req/s   p50 5.42ms   p99 11.10ms
```

Fastify is ~3.5× Express. The **bridge** is what costs: `app.use()` runs
Express's entire middleware chain on every request, native routes included.

Two traps already paid for:

1. **Benchmarking in-process.** An earlier run put the load generator in the
   server process and reported Fastify as *slower with a better tail*. Both
   halves were artifacts of sharing one event loop. Always measure from a
   separate process.
2. **`setNotFoundHandler` delegation without handing over the body.** Reaching
   Express only when Fastify has no route is the right shape, but Fastify parses
   the body first, so Express's parser saw an empty stream and **every POST
   returned 500** while GETs kept working. A pass-through content-type parser
   does not fix it.

   The fix is to give Express the already-parsed body and mark it parsed —
   `body-parser` skips when `req._body` is set, which is what that flag is for:

   ```ts
   app.setNotFoundHandler((req, reply) => {
     const raw = req.raw as unknown as { body?: unknown; _body?: boolean };
     if (req.body !== undefined) { raw.body = req.body; raw._body = true; }
     expressApp(req.raw, reply.raw);
   });
   ```

With that in place, measured again:

```
fastify native route          43984 req/s   p50 1.06ms   p99 2.25ms
fastify -> express fallback   26171 req/s   p50 1.78ms   p99 4.29ms
express standalone            15209 req/s   p50 2.80ms   p99 9.15ms
```

A native route is ~2.5x Express, and an un-ported route is *still* faster than
Express standalone because Fastify's HTTP layer handles it before handing off.
**Porting routes is now incremental and safe**, which is the unlock the previous
version of this document said was missing.

### Removing Express entirely

The remaining surface, measured rather than guessed:

- 10 route files
- 142 `res.status(`, 79 `res.json(`
- cookies (`res.cookie` / `clearCookie`), `res.redirect`, `res.sendFile`
- NDJSON streaming on `/migration/execute` (`res.write` / `res.end`)

Port in batches, verifying each against the running server, and delete Express
when the fallback stops being reached. Do not attempt it in one pass: the e2e
suite that would catch a regression cannot run reliably on a machine that
cannot hold all 11 engines.

---

## 3. Resilience layers, and what each actually protects

| Layer | Where | Protects against |
|---|---|---|
| Circuit breaker | `packages/db/src/cores/circuit-breaker.ts` | A dead or hanging database tying up request slots. Opens after 3 consecutive *availability* failures; a hanging target went 4s → 0ms. |
| Pool error guard | `packages/db/src/cores/pool-error-guard.ts` | An idle-connection `'error'` event killing the process. This was a **real crash**, observed. |
| Target lock | `backend/platform/guards/target-lock.ts` | Two people migrating the same schema at once. |
| Rate limit | `backend/platform/guards/rate-limit.ts` | Endpoint floods. |
| Idempotency | `writeIdempotency` middleware | A retried write applying twice. |

**Important distinction the circuit breaker makes**: a syntax error or
permission denial is a *healthy* server saying no. Counting those would trip the
breaker on a user's typo and lock them out of a working database. Only
connect/timeout-class failures count — see `isAvailabilityFailure`.

**Scope, stated honestly**: the breaker, the lock and the limiter are all
per-process and in-memory. They protect one deployment from itself, which is the
case that actually happens. Coordinating two deployments against one database
needs a lock the database holds; do not imply otherwise in UI copy.

---

## 4. Logging

Pino, configured in `backend/platform/logger/logger.ts`.

- **Fastify owns the logger** (`Fastify({ logger: loggerConfig() })`), which is
  what gives every line a request id without a correlation mechanism of our own.
- `/api/health` is `logLevel: 'silent'` — the CLI launcher and the offline
  banner poll it constantly.
- Destinations: pretty in dev, JSON stdout in production, JSON file when
  `FOX_LOG_FILE` is set. The file option exists because Fox Schema also ships as
  a desktop app and a CLI where there is no platform collector. **In containers
  prefer stdout.**
- Redaction covers `password`, `option.password`, `connectionString`, `token`,
  `secret`, `apiKey`, and auth/cookie headers. Verified by test.

### The database package does not depend on Pino

`packages/db/src/cores/logger.ts` defines a **structural** `AppLogger` — no pino
import, no Fastify import. Pino satisfies it; so does a test double. The driver
runtime stays usable from the CLI, a worker, or a test with no logging stack.
Install it with `ConnectionFactory.useLogger(...)`; it is silent otherwise.

### What database logging does and does not record

Every query emits one structured line: `component`, `operation`, `engine`,
`target`, `durationMs`, `rowCount`. Slower than `SLOW_DB_QUERY_MS` (default
500ms) is `warn`, otherwise `debug`.

**Never logged**: SQL text, parameters, or rows. SQL can embed literals and rows
are the user's data. `target` is `host:port/database` — never the connection
string, which carries the password.

**Failures are logged at `debug`, not `error`** — the Fastify error boundary
logs the failure once. Logging at each layer turns one failure into four lines.

### Known limitation

`ConnectionFactory.useLogger` installs one **process-level** logger, so database
lines carry no request id. The plan's §63 recommends threading the request's
child logger down instead. That is a large refactor across many call sites and
has not been done. Database lines correlate by time, not by `reqId`.

---

## 5. Module structure — one folder per business feature

Every backend file lives in a feature folder. Nothing sits loose in `features/`,
and `api/` holds only the shared HTTP edge.

```
backend/
  api/            server.ts · fastify-server.ts · routes.ts · shared edge helpers
  platform/       cross-cutting, feature-agnostic
                    contracts/  ActorContext
                    guards/     origin-policy · rate-limit · idempotency
                                target-lock · security-headers
                    http/       types · router · fastify-bind · respond · redact
                    logger/     pino config + redaction
                    db/         connection resolve · db-errors
                    crypto/     secret encryption
  internal/       callable in-process, deliberately not exposed as API
  features/       one folder per business domain
    auth            login, sessions, SSO
    authorization   RBAC: role/permission service + the requirePermissions guard
    users           profile, preferences, onboarding state, first-run wizard
    admin           install-wide config: app settings, secrets, cloud credentials
    compare         schema comparison
    schema          schema read
    history         schema history (Lokee)
    migration       DDL migration + run history
    data-migrate    data movement + run history
    sql-editor      SQL editor, code cells, sandboxed execution
    access          permissions inspector, DBA utilities, index maintenance
    connections     saved connection store
    files           file upload sessions, file-query
    import-process  the ingest engine: streaming parsers, column detection,
                    capacity limits, worker pool, worker entrypoint
```

### The layers inside a module

`route → guard → handler → controller → service`, top to bottom. A module uses
the layers it needs; it does not grow empty ones for symmetry.

`compare/` is the only module built out in all five. Its controller is currently
a **pass-through** — the service does its own permission check, so the
controller only forwards. That is recorded in the file rather than dressed up:
the layer earns its place when resource-level authorization and the scope-aware
cache attach there. If those land elsewhere, delete it.

The service layer is the valuable one and is what to copy: transport-independent,
takes an `ActorContext`, returns a value, testable with no HTTP server.

### Naming

| Suffix | Role |
|---|---|
| `*.routes.ts` | Express router: paths, middleware order, mounting |
| `*.guard.ts` | Middleware that admits or refuses a request |
| `*.handler.ts` | One endpoint: parse the request, call a controller |
| `*.controller.ts` | One feature: orchestrate services, own the cache seam |
| `*.service.ts` | Business logic, no HTTP types |
| `*.worker.ts` / `*-thread.ts` | Worker entrypoints — **spawned by file path** |

### Two traps this layout has already sprung

**Package exports are duplicated.** `apps/web/package.json` `exports` and the
alias list in the repo-root `vitest.config.ts` are two hand-maintained copies of
the same map. Moving a file named in one and not the other typechecks clean and
fails only in the CLI tests. Change both.

**Worker entrypoints are referenced as strings.** `files.routes.ts` spawns
`import-process/parse-file.worker.ts` via `new URL(...)`, and
`editor/code-cell-execute.service.ts` spawns `code-cell-thread.ts` the same way.
`tsc` cannot see either path. After any move, grep `new Worker(` and `new URL('`
and check the resolved path on disk — then actually run the upload, since only a
request over 512KB takes the worker branch at all.

**Typecheck and tests are not enough.** A route that passed both hung forever in
this codebase: `idempotency` is a *factory*, was passed to `router.post` as if it
were middleware, and never called `next()`. Every extraction ends with a live
curl of the moved endpoints.

---

## 6. Index Management — a resolved bug worth understanding

Reported as "I ran defragment, refreshed, and the percentage did not change."

The maintenance **had** run. On the demo data the indexes were `relpages = 1` on
a 0-row table, so Postgres `pgstatindex` returns `NaN`, which the query converts
to null. There was nothing to reclaim and nothing to measure.

The real defect was that the UI gave no way to tell that apart from a broken
button. `describeFragmentationChange` now states the outcome: a real reduction,
an already-compact index, an unmeasurable one, or a figure that will not move
until the engine's statistics are refreshed.

**General lesson**: verifying that a statement *executed* is not the same as
verifying it had an *effect*. The defrag matrix checked execution across 11
engines and still missed this.

---

## 7. Ground rules that keep biting

- **Seed exit codes lie.** `seed-all.sh` reports "NOT seeded" for Db2 (benign
  `SQL0605W`) and sometimes CockroachDB/YugabyteDB. Verify end state directly
  before believing it — three of four such reports were false.
- **This machine cannot run all 11 engines.** CockroachDB self-terminates with
  `FATAL: disk stall`, SQL Server gets OOM-killed (exit 137). Stop the engines
  already verified before a full dialect run. Any connect-timeout failure should
  be retested in isolation before being treated as a bug.
- **Monaco virtualises.** Reading editor text from `.view-lines` silently drops
  anything below the fold.
- **Placeholders are per-driver.** `$1` Postgres, `:1` Oracle, `@pN` SQL Server,
  `$N` ClickHouse (its adapter substitutes them), `?` for the rest. Two shipped
  bugs came from assuming instead of checking the adapter.

---

## 8. Where to look

| Concern | File |
|---|---|
| Express app | `backend/api/server.ts` |
| Fastify edge | `backend/api/fastify-server.ts` |
| Routes | `backend/api/routes.ts` |
| Service pattern | `packages/server/src/features/compare/compare.service.ts` |
| Module map | section 5 of this doc |
| Logging | `backend/platform/logger/logger.ts` |
| Target locks | `backend/platform/guards/target-lock.ts` |
| Circuit breaker | `packages/db/src/cores/circuit-breaker.ts` |
| Pool guard | `packages/db/src/cores/pool-error-guard.ts` |
| Logger interface | `packages/db/src/cores/logger.ts` |

Gates: `cd apps/web && npx tsc --noEmit`, then `npx vitest run` from the root.
