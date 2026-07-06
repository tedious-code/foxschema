<div align="center">

# Fox schema

**Compare two database schemas, see exactly what differs, and generate the migration SQL to make them match — across 10 SQL dialects.**

Runs as a self-hostable **web app**, a cross-platform **desktop app**, and a **terminal CLI**.

[Quick start](#quick-start) · [User guide](docs/USER_GUIDE.md) · [Deploy](docs/DEPLOYMENT.md) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md)

</div>

---

## What it does

Point Fox at a **source** and a **target** database. It introspects both, shows a
color-coded diff of everything that changed — tables, columns, primary/foreign keys,
indexes, unique/check constraints, views, materialized views, sequences, types,
functions, procedures, triggers, and roles — then generates the DDL to bring the
target in line with the source, and can apply it for you with a pre-migration
snapshot and per-object history.

- **Schema diff** — grouped, searchable; drill into any object's column/index/FK changes.
- **Migration generation** — runnable target-dialect DDL you review before applying.
- **Cross-dialect aware** — comparing e.g. Postgres → MySQL won't false-flag equivalent
  types, and up front you see which object types translate cleanly vs. need manual review.
- **Safe apply** — dry-run by default; an optional **skip-on-error** mode continues past a
  failed object instead of rolling back the whole run; every run is recorded in history.
- **Credentials encrypted at rest** — saved passwords are never sent back to the browser.

## Supported dialects

PostgreSQL · MySQL · MariaDB · SQL Server · Azure SQL · Oracle · IBM Db2 ·
SQLite · ClickHouse · Amazon Redshift

## Quick start

### Run the web app with Docker

```bash
cp .env.example .env
# set APP_ENCRYPTION_KEY in .env  →  generate one with:  openssl rand -hex 32
docker compose -f docker-compose.app.yml up -d --build
```

Open **http://localhost:3001** (change the port with `PORT` in `.env`).

This is the **common** image (every dialect except IBM Db2; builds on any
architecture, including arm64). Db2 needs a large native driver, so it's an opt-in
build — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), which also covers cloud deploys,
using an external database, and enabling multi-user / SSO.

### Desktop app

A native macOS / Windows / Linux build (Tauri) — see [docs/desktop-build.md](docs/desktop-build.md).

### CLI

```bash
cd apps/cli
npx tsx src/index.ts setup --email you@example.com
npx tsx src/index.ts compare --source pg_c --target pg_d      # or: fox tui
```

`fox` also has a full-screen interactive TUI (`fox tui`). New to it all? Start with the
[user guide](docs/USER_GUIDE.md).

## How it's built

An npm-workspaces monorepo:

| Workspace | What it is |
|-----------|------------|
| `packages/core` | The dialect-agnostic engine — introspection, diff, migration generation/execution, and all 10 providers. |
| `apps/web` | The web app: Express API + React/Vite UI. Also the desktop app's backend. |
| `apps/desktop` | Tauri v2 shell wrapping the web UI as a native app. |
| `apps/cli` | The `fox` terminal CLI + Ink TUI. |
| `apps/e2e` | Playwright end-to-end tests against real dockerized databases. |

Deeper detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and the dialect
engine contract in [packages/core/src/providers/DIALECTS.md](packages/core/src/providers/DIALECTS.md).

## Contributing

Contributions are welcome — new dialect support, bug fixes, and docs especially.
Start with **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, the correctness gates, and
how to add a dialect.

## Security

Please report vulnerabilities privately per [SECURITY.md](SECURITY.md) — not via public issues.

## License

[Apache-2.0](LICENSE).

<sub>The product is **Fox Schema**; the packages and repository keep the `foxschema` identity (`@foxschema/*`).</sub>
