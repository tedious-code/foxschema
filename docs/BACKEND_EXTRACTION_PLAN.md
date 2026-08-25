# Backend extraction + Express removal — review and plan

Three asks, reviewed against the code as it stands today:

1. Move the backend out of the web app
2. Share it between CLI and web
3. Remove Express entirely

**All three are the right destination. They are not one change, and the order
matters more than the content.** (1) and (2) are the same change and are low
risk. (3) is a different kind of work with a fraction of the safety net, and
starting it before its precondition is the way this goes wrong.

---

## 1. Where we actually are

Measured, not estimated:

| Fact | Value |
|---|---|
| Backend size | **133 TS files, ~14,920 lines** (excluding tests) |
| Backend location | `apps/web/src/backend` — inside the web app |
| Backend → frontend imports | **0** — the boundary is already clean |
| Backend → `apps/web/src/shared` | **23 import sites** (permissions, server-beam, lokee-wire) |
| Frontend → same `shared/` | 13 files |
| Files importing `express` | **28** |
| Route declarations | **71**, across 15 `*.routes.ts` files |
| Routes natively on Fastify | **1** (`/api/health`) |
| HTTP-level backend tests | **1 file**, 9 tests (`fastify-server.test.ts`) |
| Backend test files total | 45 — service-level, no HTTP |
| e2e specs | 33 — **not wired into CI**, need live databases |

### The CLI already depends on the backend

This is not a future goal — it is today's arrangement, done the awkward way:

```jsonc
// apps/web/package.json
"./auth":              "./src/backend/modules/auth/auth.service.ts",
"./connection-store":  "./src/backend/modules/connections/connection-store.service.ts",
"./migration-history": "./src/backend/modules/migration/migration-history.service.ts",
"./app-settings":      "./src/backend/modules/admin/app-settings.service.ts",
"./store":             "./src/backend/database/store.ts",
"./serve":             "./src/backend/startUiServer.ts"
```

`apps/cli` imports five of these. The CLI depends on the **web application**
package to reach backend services it has nothing to do with the web UI to use.

**The cost is already being paid.** That map is hand-maintained in *two* places —
`apps/web/package.json` and the root `vitest.config.ts` — and `tsc` validates
neither. Moving a backend file while updating only one typechecks clean, passes
the unit suite, and fails only in the CLI tests. **This trap fired twice during
the module restructure**, once per PR.

Note how `@foxschema/sql` and `@foxschema/db` avoid it entirely: one export, one
alias line, `.` → `src/index.ts`. The problem is not that aliases exist. It is
that the backend exports **six deep paths into an app**.

### Someone already started this

`apps/web/tsconfig.json` and `apps/cli/tsconfig.json` both map:

```jsonc
"@foxschema/shared": ["../../packages/shared/src/index.ts"]
```

**`packages/shared` does not exist.** A dangling path mapping in two configs —
the intent was there and the package never landed.

---

## 2. Ask 1 + 2 — move the backend into its own package

**Verdict: yes.** This is the highest value-to-risk change of the three, and it
is mostly mechanical: the backend already imports nothing from the frontend.

### Target

```
packages/sql       pure dialect knowledge, zero deps          (unchanged)
packages/db        driver runtime, depends on sql             (unchanged)
packages/shared    NEW — wire contracts, zero deps
packages/server    NEW — the backend: HTTP edge + modules
apps/web           the Vite frontend, plus a thin serve entry
apps/cli           imports @foxschema/server, not @foxschema/web
```

Dependency direction, extending the existing one-way rule:

```
shared ← sql ← db ← server ← { web frontend, cli }
```

`packages/shared` is the unblocker, and it has to go first: the backend cannot
leave `apps/web` while 23 of its import sites point at `apps/web/src/shared`.
That directory is already effectively pure — a scan found exactly one import
across all three files, and it is type-only — so it becomes a zero-dep package
cleanly. The frontend keeps importing it (Vite-safe, unlike `@foxschema/db`).

### What this buys, concretely

- **The duplicated exports map collapses to one line** in each of the two
  configs. The failure mode that bit twice stops being possible to express.
- The CLI stops depending on the web app to get a database connection.
- `purity.test.ts` can be extended to enforce the new edge — frontend must not
  import `@foxschema/server` — the same way it already guards `db`.

### Naming

`@foxschema/server`. Not `core`: sibling repos (FoxFlow, the n8n nodes) already
build on a published `@foxschema/core`, and reusing the name here would collide
in the reader's head even if it never collides in a registry.

### Risk

Low, and the sweeps are known from the last two PRs: package exports live in two
files, worker entrypoints are strings `tsc` cannot see, and the CLI inlines
`@foxschema/*` TS sources through esbuild (`apps/cli/build.mjs`) — that keeps
working, since it is exactly how `sql` and `db` are already consumed.

**I found no `src-tauri` in this repo**, so this plan does not account for
desktop sidecar packaging. If the desktop build lives elsewhere and consumes
`@foxschema/web/serve`, that consumer needs checking before the rename.

---

## 3. Ask 3 — remove Express

**Verdict: yes, but not yet, and not in the same PR as the move.**

The destination is right. Express is currently carried *underneath* Fastify:
`fastify-server.ts` serves one native route and delegates everything else
through `@fastify/express`. That bridge is not free — measured at roughly an
**8x throughput drop** versus a native handler. Today the project pays for two
frameworks and gets the performance of the slower one.

So the argument for finishing is strong. The argument against *starting now* is
the safety net:

> **71 routes. One HTTP-level test file. The 33 e2e specs are not in CI and need
> live databases.**

A route rewrite is exactly the change that unit tests do not catch, because the
logic is unchanged and the transport is what moves. This codebase has already
produced the proof: a route that **passed typecheck and all 2363 tests hung
forever** in production shape, because middleware was wired wrong. Only a live
request found it.

### The precondition

**Build an HTTP contract suite before moving any route.** For each of the 71
routes, assert status code, response shape, and headers against a running
server — the Express one, first, to capture today's behavior as the baseline.
Then run that same suite against the Fastify implementation. That is the only
mechanism that makes a 71-route rewrite reviewable, and it is worth building
even if Express removal is deferred indefinitely.

### The real coupling is the guards, not the routes

The routes are the visible part; the guard layer is what actually blocks
incremental migration, because every route depends on it and it is shared.

**The codebase already shows the right pattern.** `rate-limit-core.ts` holds the
decision, `rate-limit.ts` is the thin Express adapter. `security-headers-core.ts`
is split the same way, and `origin-policy.ts` says so explicitly: *"Transport-
agnostic on purpose: it takes the origin and returns a verdict, so both servers
share one decision."*

Extend that pattern to the rest, and routes can then move one at a time:

| Guard | State |
|---|---|
| `rate-limit` | **Core already split** |
| `security-headers` | **Core already split** |
| `origin-policy` | **Already pure** |
| `idempotency` | Express-coupled — needs a core |
| `rbac.guard` | Express-coupled — needs a core |
| auth / user guard | Express-coupled — needs a core |

### What is genuinely hard, and should go last

Most of the 71 routes are JSON in, JSON out — `res.status().json()` accounts for
221 of the call sites and ports mechanically. The rest do not:

| Thing | Where | Why it is not mechanical |
|---|---|---|
| **NDJSON streaming** | `migration.routes.ts` | `setHeader` + `write` + `end` — progress events stream during a migration. Fastify streams differently; getting this subtly wrong breaks the live migration UI, not a test |
| **Cookies** | `auth.routes.ts`, `sso.routes.ts` | 4 sites; needs `@fastify/cookie`, and session cookies are a security boundary |
| **Redirects** | `sso.routes.ts` | 3 sites in the OAuth/OIDC flow — the hardest thing to test without a live provider |
| **File uploads** | `files.routes.ts` | 10 routes, plus the worker-backed import path |
| **Static + SPA fallback** | `startUiServer.ts` | `res.sendFile` → `@fastify/static` |

### Sequencing rule

**Do not start until it can be finished.** A half-migrated API ships both
frameworks and keeps the bridge tax — the worst of the three possible states.
Every phase below must leave the app shippable.

---

## 4. Plan

| Phase | Work | Gate |
|---|---|---|
| **0** | `packages/shared` — move `apps/web/src/shared`, fix the 23 import sites, delete the dangling tsconfig paths by making them real | tsc + full suite |
| **1** | `packages/server` — move the backend, single `.` export, repoint the CLI, collapse both copies of the exports map, extend `purity.test.ts` | tsc + full suite + live probe of moved endpoints |
| **2** | **HTTP contract suite** over all 71 routes against the Express server; wire it into CI | Suite green as the baseline |
| **3** | Give `idempotency`, `rbac.guard` and the auth guard transport-agnostic cores, following `rate-limit-core.ts` | Contract suite still green |
| **4** | Port routes to native Fastify, module by module, JSON-only first. Flip `FOX_SERVER` default to fastify once a module is native | Contract suite green after each module |
| **5** | The hard five: streaming, cookies, redirects, uploads, static | Contract suite + a manual live migration and a real SSO login |
| **6** | Delete `express`, `cors`, `@fastify/express`, `@types/express`, `@types/cors`; drop the dual-server branch in `startUiServer.ts` | Full suite + e2e run |

Phases 0 and 1 are worth doing on their own merits and are independent of
whether Express ever goes. Phase 2 is the one that is easy to skip and should
not be — it is the difference between a rewrite that is reviewable and one that
is hoped-for.

---

## 5. Open questions

1. **Does anything outside this repo import `@foxschema/web/serve`?** No
   `src-tauri` here, but the desktop shell is documented as a Node sidecar. If
   it consumes that entry, the rename is a breaking change for it.
2. **Should `packages/server` be published, or stay workspace-private?** It
   decides whether the export surface is an API contract or an internal detail —
   and therefore how carefully phase 1 has to freeze it.
3. **Is the CLI meant to keep calling backend services in-process**, or should it
   eventually talk to the HTTP API like any other client? The first keeps today's
   arrangement; the second would make `packages/server` a server and nothing
   else. This plan assumes the first, since that is what the code does now.
