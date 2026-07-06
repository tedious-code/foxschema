# Fox schema — User Guide

Fox schema compares two databases and shows you exactly what's different, then writes the
SQL to make one match the other. This guide is for **using** Fox schema — no coding required.

- [What Fox schema is for](#what-fox-is-for)
- [Install & run](#install--run)
- [First run](#first-run)
- [Connect a database](#connect-a-database)
- [Run a comparison](#run-a-comparison)
- [Read the diff](#read-the-diff)
- [Generate & apply a migration](#generate--apply-a-migration)
- [History](#history)
- [Troubleshooting](#troubleshooting)

## What Fox schena is for

Typical uses:

- **"Is staging the same as production?"** — compare the two and get a list of every
  difference.
- **"Bring dev up to date with the new schema."** — generate the migration SQL and apply it.
- **"What changed between these two databases?"** — a clear, grouped, searchable diff.

Fox schema never changes your **source** database. It only ever writes to the **target**, and
only when you explicitly apply a migration.

## Install & run

**Option A — Docker (recommended for a shared/team instance).** One command:

```bash
cp .env.example .env
# open .env and set APP_ENCRYPTION_KEY  →  generate one with:  openssl rand -hex 32
docker compose -f docker-compose.app.yml up -d --build
```

Then open **http://localhost:3001**. To use a different port, set `PORT=` in `.env`.

**Option B — Desktop app.** A regular macOS / Windows / Linux application; see
[desktop-build.md](desktop-build.md). Nothing to configure — it stores its data locally.

## First run

The first time you open Fox schema it sets up an **encryption key** that protects the
database passwords you save. With Docker this is the `APP_ENCRYPTION_KEY` you put in
`.env`; on desktop it's created for you and kept in your OS keychain.

> Keep that key stable. If it changes, previously saved passwords can no longer be
> read and you'll need to re-enter them.

## Connect a database

1. Click **Add connection** (or the connection dropdown → new).
2. Pick the **type** (PostgreSQL, MySQL, SQL Server, Oracle, Db2, …).
3. Fill in host, port, database, username, and password. Optionally a schema.
4. **Test** the connection, then save it. Passwords are encrypted — they're stored
   safely and never shown back to your browser.

Do this for both the database you're comparing **from** (source) and the one you're
comparing **to** (target).

## Run a comparison

1. Choose a **source** connection and a **target** connection.
2. Click **Compare**.

Fox schema reads both schemas and builds the diff. You can narrow what it looks at (tables
only, views, functions, etc.) with the scope filter.

## Read the diff

Results are grouped by object type with a summary at the top:

- **+ Added** (green) — exists in source, missing in target.
- **~ Modified** (yellow) — exists in both but differs.
- **− Removed** (red) — exists in target, not in source.
- **= Unchanged** (dim) — identical.

Click any object to drill in and see the exact column, index, foreign-key, and
trigger differences. Use the search box to jump to a specific name.

**Comparing two different database types?** (e.g. Postgres → MySQL) Fox is
cross-dialect aware: equivalent types aren't flagged as changes, and a readiness
panel tells you up front which object types translate cleanly and which need a manual
look (view/function bodies, for instance, aren't auto-translated).

## Generate & apply a migration

1. From the diff, choose **Generate migration** (or the DDL view).
2. Review the SQL — it targets the **target** database's dialect. Nothing has been
   applied yet.
3. To apply it, choose **Deploy / Migrate**. You'll get a confirmation and a
   pre-migration snapshot is taken first.
4. **Skip failures (optional):** turn this on and Fox continues past any single object
   that fails, instead of rolling back the whole run — useful for large migrations
   where you want to apply what you can and fix the rest afterward. The result then
   shows "completed with failures" and lists what was skipped.

You can always just copy the generated SQL and run it yourself instead of applying it
through Fox schema.

## History

Every migration you apply is recorded — status, target, the exact script, the
pre-migration snapshot, and per-object results. Open **History** to review or
re-inspect past runs. No passwords are stored in history.

## Troubleshooting

**"Connection failed" / timeout.** Check host, port, and that the database accepts
connections from where Fox schema runs (in Docker, `localhost` means *inside the container* —
use the host's IP or a service name, not `localhost`, to reach a DB on your machine).

**Port already in use.** Change `PORT` in `.env` and restart (`docker compose -f
docker-compose.app.yml up -d`).

**"driver not installed" for a database type.** Some drivers are optional/platform-
specific (notably IBM Db2). See [DEPLOYMENT.md](DEPLOYMENT.md#database-drivers).

**Saved passwords stopped working.** The encryption key changed. Restore the original
`APP_ENCRYPTION_KEY`, or re-enter the passwords.

**Lost my saved connections/history after a restart (Docker).** The app data lives on
the `/data` volume — make sure you didn't remove it (`docker compose down -v` deletes
volumes). See [DEPLOYMENT.md](DEPLOYMENT.md).

Still stuck? Open a GitHub issue with what you did and the error you saw.
