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

## Dialect knowledge — `packages/sql/src`

```
interfaces/  The shared vocabulary: TableSchema, TableDiff, MigrationStep.
providers/   One folder per dialect — its settings and its SqlDialect.
cores/       Connection strings, and shaping catalog rows into TableSchema.
modules/     One folder per domain, named to match the frontend feature
             that consumes it.
```

| Folder | What it covers |
|---|---|
| `dialect` | The `SqlDialect` contract, the registry, type mapping, capability flags |
| `sql-text` | Statement splitting and SQL templating |
| `schema-diff` | Comparing two schemas, and browsing one |
| `migrations` | Generating DDL, ordering drops, validating a plan |
| `lokee-weave` | Content-addressed schema versioning and revert |
| `sql-editor` | FoxScript parsing, code cells, SELECT aliasing, the SQL subset |
| `access` | Permission intent, effective access, GRANT/REVOKE and account DDL |
| `utilities` | DBA queries: server insights, index fragmentation |

`dialect` and `sql-text` are the foundations: the other folders build on
them, never the reverse.

Code outside this package imports the `@foxschema/sql` barrel. Module paths
are internal — `exports` in `package.json` maps only `.`, so a deep import
does not resolve.

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
| Calling an API endpoint | use `api` from `@/shared/api/client` — never `fetch` directly |
| SQL for permissions or accounts | `packages/sql/src/modules/access/` |
| A dialect capability the app must branch on | `packages/sql/src/modules/dialect/` |
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

## Calling the API from the frontend

Every request goes through one client, so the base URL, the session cookie, the
JSON headers and error handling are applied in a single place:

```ts
import { api } from '@/shared/api/client';

const info = await api.get<UpdateInfo>('/updates/check');
const runs = await api.get<Runs>('/migrations', { query: { limit: 20 } });
const { secret } = await api.post<{ secret: Secret }>('/app-secrets', input);
await api.put(`/connections/${id}`, changes);
await api.delete(`/connections/${id}`);
```

Paths are relative to the API base, so write `/schema/load`, not
`/api/schema/load`.

Options: `query`, `signal`, `headers`, `allowEmpty`, `noStore`.

A failed request throws `ApiError`, carrying `status` and the server's `code`:

```ts
try {
  await api.post('/compare', ref);
} catch (e) {
  if (e instanceof ApiError && e.code === 'unauthenticated') redirectToLogin();
}
```

For responses that are not JSON — a streamed NDJSON migration, a file download
— use `api.raw`, which returns the `Response` untouched.
