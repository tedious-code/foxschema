<div align="center">

# Fox Schema

**Compare two database schemas, see exactly what differs, and generate the migration SQL to make them match — across 10 SQL dialects.**

Runs as a **CLI** (npm / Homebrew) that opens a local web UI, or a self-hostable
**Docker** image. Windows: `npm install -g foxschema`.

[foxschema.com](https://foxschema.com) · [Quick start](#quick-start) · [User guide](docs/USER_GUIDE.md) · [Deploy](docs/DEPLOYMENT.md) · [Homebrew](docs/homebrew.md) · [Winget](docs/winget.md) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/ARCHITECTURE.md)
</div>

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

## Demo

![Fox Schema demo — connect, compare, migration SQL, execute, history](docs/demo/foxschema-demo.gif)

## Supported dialects

PostgreSQL · MySQL · MariaDB · SQL Server · Azure SQL · Oracle · IBM Db2 ·
SQLite · ClickHouse · Amazon Redshift

## Quick start

### CLI (recommended) — open the UI in your browser

Requires **Node.js ≥ 22.5**.

```bash
npm install -g foxschema
foxschema
```

Starts a local UI + API on **http://localhost:3210** and opens your browser.
Stop with `foxschema stop`. Diagnostics: `foxschema doctor`.

Homebrew (Arm + Intel): see [docs/homebrew.md](docs/homebrew.md).

```bash
brew tap tedious-code/foxschema
brew install foxschema
foxschema
```

Windows: same `npm install -g foxschema` (winget MSI channel retired — see [docs/winget.md](docs/winget.md)).

One product — Docker and npm include Db2 support where the platform allows (`ibm_db`; not on linux/arm64).

Line commands still work: `foxschema compare`, `foxschema migrate`, `foxschema tui`.

### Docker (self-host / servers)

Single image (linux/amd64, **includes Db2**):

```bash
docker pull 5nickels/foxschema:latest
docker run -d --name foxschema \
  -p 3001:3001 \
  -v foxschema_data:/data \
  5nickels/foxschema:latest
```

Open **http://localhost:3001**. Details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## How it's built

An npm-workspaces monorepo:

| Workspace | What it is |
|-----------|------------|
| `packages/core` | The dialect-agnostic engine — introspection, diff, migration generation/execution, and all 10 providers. |
| `apps/web` | Express API + React/Vite UI (also served by the CLI launcher and Docker). |
| `apps/cli` | Public `foxschema` CLI — browser launcher + line commands + Ink TUI. |
| `apps/desktop` | Retired Tauri shell (not released). |
| `apps/e2e` | Playwright end-to-end tests against real dockerized databases. |

Deeper detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and the dialect
engine contract in [packages/core/src/providers/DIALECTS.md](packages/core/src/providers/DIALECTS.md).

# 🦊 FoxSchema

> **The fastest open-source cross-database schema comparison and migration tool.**

Compare, migrate, and deploy database schemas across multiple database systems with a modern desktop UI and powerful CLI.

---

## ✨ Why FoxSchema?

Managing database schema changes across different environments is difficult.

FoxSchema helps developers and database administrators:

* 🔍 Compare database schemas
* 🚀 Generate migration scripts
* 🔄 Synchronize databases safely
* 🌍 Work across multiple database engines
* 💻 Use either a Desktop application or CLI

Built with **Rust** for speed, reliability, and low memory usage.

---

## 🚀 Features

* Schema comparison
* Schema synchronization
* Migration script generation
* Dependency-aware deployment
* Cross-database object comparison
* Safe deployment preview
* Visual diff viewer
* Desktop application
* Command-line interface (CLI)
* Offline execution
* Cross-platform (Windows, macOS, Linux)
* Rollback generation
* Drift detection
* CI/CD integration

---

## 🗄 Supported Databases

| Database        | Status |
| --------------- | ------ |
| PostgreSQL      | ✅      |
| MySQL           | ✅      |
| MariaDB         | ✅      |
| SQL Server      | ✅      |
| Oracle          | ✅      |
| IBM Db2         | ✅      |
| SQLite          | ✅      |
| ClickHouse      | ✅      |
| Amazon Redshift | ✅      |
| Azure SQL       | ✅      |

---

## 🔍 Supported Database Objects

FoxSchema compares more than just tables.

Supported objects include:

* Tables
* Columns
* Primary Keys
* Foreign Keys
* Unique Constraints
* Check Constraints
* Indexes
* Views
* Materialized Views
* Sequences
* Triggers
* Functions
* Procedures
* Extensions (PostgreSQL)
* User-defined Types
* Schemas
* Defaults


Additional database-specific objects are continuously being added.

---

## 📷 Screenshots

<img width="2842" height="1328" alt="image" src="https://github.com/user-attachments/assets/eeb9e69e-97f0-433a-b334-b66ceabdf4fc" />

Migration schema

<img width="1902" height="1354" alt="image" src="https://github.com/user-attachments/assets/68a32b0f-9e52-450c-a0e8-7110ea06b41b" />


---

## ⚡ Quick Start

### Desktop

Download the latest release and connect to your database.

### CLI

```bash
foxschema compare \
  --source postgres://... \
  --target postgres://...
```

Generate migration:

```bash
foxschema migrate \
  --source postgres://... \
  --target postgres://...
```

---

## 🏗 Architecture

FoxSchema is designed around a dependency-aware execution engine.

```
Database
      │
      ▼
Metadata Extraction
      │
      ▼
Object Comparison
      │
      ▼
Dependency Graph
      │
      ▼
Migration Planner
      │
      ▼
SQL Generator
      │
      ▼
Deployment
```

---

## 📚 Documentation

Full documentation is available at:

**https://foxschema.com**

---

## 🤝 Contributing

Contributions are welcome!

You can help by:

* Reporting bugs
* Suggesting new features
* Improving documentation
* Submitting pull requests

---

## ❤️ Support

If FoxSchema saves you time, you can support the project by:

* ⭐ Star this repository
* ❤️ Become a GitHub Sponsor
* ☕ Buy me a coffee
* Share FoxSchema with your team

Every contribution helps improve the project.

---

## 📄 License

[Apache-2.0](LICENSE).

<sub>The product is **Fox Schema**; the packages and repository keep the `foxschema` identity (`@foxschema/*`).</sub>
