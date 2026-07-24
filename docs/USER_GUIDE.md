# Fox Schema — User Guide

Fox Schema compares two databases and shows you exactly what's different, then writes the
SQL to make one match the other. This guide is for **using** Fox Schema — no coding required.

- [What Fox Schema is for](#what-fox-schema-is-for)
- [Install & run](#install--run)
- [First run](#first-run)
- [Connect a database](#connect-a-database)
- [Run a comparison](#run-a-comparison)
- [Read the diff](#read-the-diff)
- [Generate & apply a migration](#generate--apply-a-migration)
- [SQL Editor](#sql-editor)
- [History](#history)
- [Troubleshooting](#troubleshooting)

## What Fox Schema is for

Typical uses:

- **"Is staging the same as production?"** — compare the two and get a list of every
  difference.
- **"Bring dev up to date with the new schema."** — generate the migration SQL and apply it.
- **"What changed between these two databases?"** — a clear, grouped, searchable diff.

Fox Schema never changes your **source** database. It only ever writes to the **target**, and
only when you explicitly apply a migration.

## Install & run

**Option A — CLI (recommended on your laptop).** Install, then open the local UI:

```bash
npm install -g foxschema
# or Homebrew:
# brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
# brew trust tedious-code/foxschema && brew install foxschema
foxschema                         # http://localhost:3210
foxschema shortcut                # optional Fox icon on your Desktop
```

Full install matrix (npm, Homebrew, Winget, Docker, curl/wget): [INSTALL.md](INSTALL.md).

**Option B — Docker (shared/team server):**

```bash
docker pull 5nickels/foxschema:latest
docker run -d --name foxschema -p 3001:3001 -v foxschema_data:/data 5nickels/foxschema:latest
```

Open **http://localhost:3001**. Details: [DEPLOYMENT.md](DEPLOYMENT.md).

## First run

The first time you open Fox Schema it sets up an **encryption key** that protects the
database passwords you save. The CLI creates one under your user data directory; Docker
auto-generates one on the `/data` volume (or use `APP_ENCRYPTION_KEY` in `.env`).

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

Fox Schema reads both schemas and builds the diff. You can narrow what it looks at (tables
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
through Fox Schema.

## SQL Editor

Use the **SQL Editor** to run ad-hoc queries and inspect data (separate from schema
compare / migrate). It lives in the same local web UI you open with `foxschema`.

1. Open Fox Schema (`foxschema` or the Desktop shortcut).
2. In the top toolbar, click **SQL Editor** (next to Schema Sync).
3. Under **Destinations**, check one or more saved connections — the same SQL runs
   against every checked server (handy for comparing data across environments).
4. Type SQL in the editor. Multiple statements are fine; use the **statement strip**
   under the editor to enable/disable individual statements before Run. Or **select**
   a statement (or any SQL) in the editor — Run becomes **Run selection** and only
   that text is executed (variables still expand).
5. Click **Run**. Results appear below, grouped by connection (stack or side-by-side).

Tips:

- **Tabs** — open several buffers; rename with double-click. SQL text is remembered
  locally; result grids are not.
- **Schema explorer** — browse objects on the left; click a name to insert it at the
  cursor. Autocomplete uses the checked connections’ schemas when available.
- **Format** — pretty-print the buffer. **Clear** removes results for the active tab.
- **Bookmarks** — save reusable snippets from the sidebar.
- **Variables** — named values reused as `${{name}}` or `${{name.col}}` (table
  column → list). Add them in the **Variables** sidebar; right-click a result
  **cell** (scalar), **column header** (list), or **# / empty grid** (table); or
  use leading comments so Run captures automatically — put `-- @set`
  **immediately above** the SELECT it applies to (not below the previous query):

  ```sql
  -- @set orderid
  SELECT id FROM "ORDER" ORDER BY id DESC FETCH FIRST 1 ROW ONLY;

  -- @set ids = column id
  SELECT id FROM ORDER_TIME WHERE orderId = ${{orderid}};

  -- @set t = table
  SELECT id, name FROM users;

  SELECT * FROM ORDER_ANSWER WHERE ORDERID IN (${{ids}});
  -- table column: ${{t.id}}   whole table: ${{t}} → VALUES (…)
  ```

  Typing `${{` / `${{name.` autocompletes names and table columns. Hover a ref for
  its value (or `N×M table`). Hover a statement in the strip (when it uses vars) to
  preview **query with values** and **Copy**. Statements in one Run are sequential
  so later SQL can use vars set by earlier `@set`. Multi-destination: `@set` uses
  the first successful server’s result. Substitution is local (values are pasted
  into the SQL text before send — not database bind parameters). Missing/empty
  vars fail the run with a clear error; failed `@set` shows an amber warning above
  the results.

  **Secrets** — mark a variable as secret to mask it in the sidebar, hover, and
  statement preview. Secret **values are session-only** (not written to
  localStorage); after reload, re-enter them or capture again with `@set` / the
  grid. Note: substitution still embeds the value in the SQL sent to the server.

  **Per connection** — scalars and lists can override the global value per saved
  destination (expand **Per connection…** in the sidebar). Multi-destination runs
  substitute each server with its override. `@set` and grid capture still update
  the **global** base value.

  **Export / import** — download or upload JSON from the Variables panel. Secret
  entries export as stubs (name + flag only, no values). Click a table variable’s
  size line to preview columns and rows.
- **Safe mode** — when on, write/DDL statements need an extra confirmation before run.
- **Max rows** — caps how many rows each statement returns (avoids huge result sets).

Writes and DDL are allowed when you confirm them. Some dialects (e.g. SQLite /
ClickHouse adapters used for SELECT-only paths) may reject writes with a clear error
per connection cell.

Switch back to **Schema Sync** anytime to compare and migrate schemas.

## History

Every migration you apply is recorded — status, target, the exact script, the
pre-migration snapshot, and per-object results. Open **History** to review or
re-inspect past runs. No passwords are stored in history.

## Troubleshooting

**"Connection failed" / timeout.** Check host, port, and that the database accepts
connections from where Fox Schema runs (in Docker, `localhost` means *inside the container* —
use the host's IP or a service name, not `localhost`, to reach a DB on your machine).

**Port already in use (CLI).** Something else is on **3210**. Stop Fox
(`foxschema stop`) or free that port, then run `foxschema` again.

**Port already in use (Docker).** Change `PORT` in `.env` and restart
(`docker compose -f docker-compose.app.yml up -d`).

**"driver not installed" for a database type.** Some drivers are optional/platform-
specific (notably IBM Db2). Run `foxschema doctor`, or see
[DEPLOYMENT.md](DEPLOYMENT.md#database-drivers).

**Saved passwords stopped working.** The encryption key changed. For the CLI, keep the
same data directory; for Docker, restore the original `APP_ENCRYPTION_KEY` / volume, or
re-enter the passwords.

**Desktop shortcut does nothing / browser does not open.** Run `foxschema doctor`, then
`foxschema` from a terminal. Re-create the shortcut with `foxschema shortcut`.

**Lost my saved connections/history after a restart (Docker).** The app data lives on
the `/data` volume — make sure you didn't remove it (`docker compose down -v` deletes
volumes). See [DEPLOYMENT.md](DEPLOYMENT.md).

Still stuck? Open a GitHub issue with what you did and the error you saw.
