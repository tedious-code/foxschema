<div align="center">

# Fox Schema

**Compare two database schemas, see exactly what differs, and generate the migration SQL to make them match — across 10 SQL dialects.**

Install the CLI, then open the **local web UI** in your browser (or double-click the
Fox desktop shortcut). Self-host with **Docker** when you need a server.

[foxschema.com](https://foxschema.com) · [Install](docs/INSTALL.md) · [Publish](docs/PUBLISH.md) · [User guide](docs/USER_GUIDE.md) · [Deploy](docs/DEPLOYMENT.md) · [Contributing](CONTRIBUTING.md)

</div>

## Install

Requires **Node.js ≥ 22.5** (npm / Homebrew). Docker needs no Node.

```bash
# npm — macOS, Windows, Linux (arm64 + x64)
npm install -g foxschema

# Homebrew — macOS (formula in this repo; Homebrew 6+ needs trust once)
brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
brew trust tedious-code/foxschema
brew install foxschema

# Docker — servers (linux/amd64, includes Db2)
docker pull 5nickels/foxschema:latest
```

Windows (Winget — after package merge):

```powershell
winget install TediousCode.FoxSchema
```

Or Node + npm:

```powershell
winget install OpenJS.NodeJS.LTS
npm install -g foxschema
```

Full matrix (curl/wget, shortcut, troubleshooting): **[docs/INSTALL.md](docs/INSTALL.md)**.

## Use the app

```bash
foxschema                 # start UI on http://localhost:3210 and open the browser
foxschema shortcut        # put a Fox icon on your Desktop
foxschema stop            # stop the background server
foxschema doctor
```

**Desktop shortcut:** after install, run `foxschema shortcut`. Double-click **Fox Schema**
anytime to open the UI. If you closed the browser without `stop`, the server is still
running — the shortcut just reopens the browser.

Headless / CI:

```bash
foxschema compare --source a --target b
foxschema migrate --source a --target b
foxschema tui
```

## Docker (self-host)

```bash
docker run -d --name foxschema \
  -p 3001:3001 \
  -v foxschema_data:/data \
  5nickels/foxschema:latest
```

Open **http://localhost:3001**. Guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## What it does

Point Fox at a **source** and a **target** database. It introspects both, shows a
color-coded diff — tables, columns, keys, indexes, constraints, views, sequences,
functions, procedures, triggers, roles — then generates DDL to align the target,
with dry-run by default and optional apply + history.

- **Schema diff** — grouped, searchable; drill into column/index/FK changes.
- **Migration generation** — reviewable target-dialect DDL.
- **SQL Editor** — run queries against one or more saved connections; multi-tab,
  statement strip, schema explorer (see [User guide](docs/USER_GUIDE.md#sql-editor)).
- **Cross-dialect aware** — fewer false positives across e.g. Postgres → MySQL.
- **Safe apply** — dry-run by default; skip-on-error optional; history recorded.
- **Credentials encrypted at rest** — passwords never returned to the browser.

## Demo

![Fox Schema demo — connect, compare, migration SQL, execute, history](docs/demo/foxschema-demo.gif)

## Supported dialects

PostgreSQL · MySQL · MariaDB · SQL Server · Azure SQL · Oracle · IBM Db2 ·
SQLite · ClickHouse · Amazon Redshift

One product — no separate “Db2 edition”. Docker image includes Db2 on linux/amd64.

## How it's built

npm workspaces:

| Workspace | Role |
|-----------|------|
| `packages/core` | Diff / migration engine and dialect providers |
| `apps/web` | Express API + React UI (CLI launcher + Docker) |
| `apps/cli` | `foxschema` CLI, desktop shortcut, TUI |
| `apps/e2e` | Playwright tests against dockerized databases |

Maintainers: [docs/PUBLISH.md](docs/PUBLISH.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[packages/core/src/providers/DIALECTS.md](packages/core/src/providers/DIALECTS.md).

## License

Apache-2.0
