# Where things live

A map of the repository, and where a change belongs.

## Packages

```
packages/sql        Dialect knowledge: SQL generation, schema compare,
                    statement splitting, type mapping. No dependencies,
                    no Node built-ins — it runs in a browser too.

packages/db         Database drivers and the connection runtime: connection
                    factory, pooling, circuit breaker. Depends on sql.

packages/shared     Contracts the frontend, server and CLI must agree on:
                    permission names, error codes, wire message shapes.
                    Browser-safe.

packages/server     The backend: HTTP layer, feature modules, metadata store.

apps/web            The frontend, plus the entry point that serves it.
apps/cli            The `foxschema` command line tool.
apps/e2e            Browser tests that drive the running application.
```

Imports may only run in one direction:

```
sql  ←  db      ←  server  ←  web, cli
sql  ←  shared  ←  server, web, cli
```

`packages/sql/src/purity.test.ts` and `packages/shared/src/purity.test.ts`
enforce this. The frontend must never import `@foxschema/db` or
`@foxschema/server`.

## Backend — `packages/server/src`

```
api/         The HTTP server itself: Fastify setup, route tree, security
             headers. Nothing business-specific.

platform/    Cross-cutting infrastructure used by every feature.
  contracts/   ActorContext and ServiceError
  guards/      origin policy, rate limit, idempotency, target locks
  http/        request/response types, router, Fastify binding, responses
  db/          connection resolution
  crypto/      secret encryption
  logger/      logging configuration

features/    One folder per business domain (see below).

internal/    Callable in-process but deliberately not exposed as API:
             driver install, update checks, cloud secrets.

database/    The metadata store and its migrations.
```

### Backend features

| Folder | What it covers |
|---|---|
| `access` | Database permission inspection and DBA utilities |
| `admin` | Install-wide settings, secrets, cloud credentials |
| `auth` | Login, sessions, SSO |
| `authorization` | Role permissions (RBAC) and the permission guard |
| `compare` | Schema comparison |
| `connections` | Saved database connections |
| `data-migrate` | Moving data between databases |
| `files` | File uploads and querying an uploaded file |
| `history` | Schema history and revert (Lokee Weave) |
| `import-process` | Parsers, column detection and the worker pool used by imports |
| `migration` | Applying DDL migrations, and their run history |
| `schema` | Reading a schema |
| `sql-editor` | SQL editor, code cells, sandboxed execution |
| `users` | Profile, preferences, first-run wizard |

Inside a feature:

```
*.routes.ts      paths, methods and which guards run
*.guard.ts       admits or refuses a request
*.handler.ts     one endpoint: read the request, call a controller
*.controller.ts  orchestrates services for one feature
*.service.ts     business logic, no HTTP types
*.worker.ts      worker entrypoints — these are loaded by file path,
*-thread.ts      so renaming one needs a matching update at the call site
```

A feature uses the layers it needs; it does not create empty ones.

## Frontend — `apps/web/src/frontend`

```
app/         The application shell, settings screens and global stores.
features/    One folder per business domain.
shared/      Reusable across features: api clients, ui components, lib, utils.
```

Imports may run `app → features → shared`, never `shared → features`.
`architecture.test.ts` enforces it.

### Frontend features

| Folder | What it covers |
|---|---|
| `access` | Permission builder, inspector and report |
| `admin` | User and role administration |
| `auth` | Sign-in, SSO buttons, onboarding |
| `connections` | Connection modal, credential manager, database settings |
| `lokee-weave` | Schema history graph and version compare |
| `migrations` | Migration run history |
| `object-detail` | Detail panel for a single schema object |
| `schema-diff` | Diff rendering shared by compare and history |
| `sql-editor` | SQL editor, results grid, data peek, utilities |
| `utilities` | Clone table, index management, server insights |

## Where does my change go?

| Change | Where |
|---|---|
| New API endpoint | `packages/server/src/features/<domain>/` |
| Dialect-specific SQL | `packages/sql/src/providers/<dialect>/` |
| A new driver | `packages/db/src/providers/<dialect>/` |
| Something the frontend and backend both need | `packages/shared/src/` |
| New screen or panel | `apps/web/src/frontend/features/<domain>/` |
| Reusable UI or helper | `apps/web/src/frontend/shared/` |
| Guard or cross-cutting HTTP concern | `packages/server/src/platform/` |

## Checks to run

```bash
cd apps/web && npx tsc --noEmit     # typecheck (covers packages too)
npx vitest run                      # all tests, from the repository root
npx eslint .
npm run build -w @foxschema/web     # the bundler catches what tsc cannot
```

Run `npx vitest run` from the repository root. Running it from `apps/web`
selects a different project configuration and reports failures that are not
real.
