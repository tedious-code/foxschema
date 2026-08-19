# Fox Schema 0.2.111 — What's new

> **For users:** this is the page the in-app update toast links to (**What's new**).

Since **`v0.2.73`** (last npm/Homebrew publish). Docker Hub / GHCR already have
`5nickels/foxschema:v0.2.111` and `ghcr.io/tedious-code/foxschema:v0.2.111`.

---

## What's new

### Schema History

Schema History lives in **Schema Sync → History**. It tracks versions of **one**
database (not a second live connection).

- Take a snapshot from a saved credential. The graph shows versions over time.
- **Original** and **Target** pickers work like Compare: Original is a version;
  Target is the current database or an older version. Changing the pickers does
  **not** hide the graph.
- **Compare versions** is a preview. It does not write the live database until
  you press Execute.
- **Revert** runs only against the **current database**, snapshots first, and
  **appends** a new version (it never rewrites the version you picked).
- Tick the objects to revert, or **Select all**. Nothing ticked means nothing
  runs. Only ticked objects are in the generated SQL.
- Click a table on the graph to see column and constraint changes.
- SQLite and DuckDB file credentials can be picked from a Browse dialog on the
  machine running Fox Schema.

### SQL Editor

- Copy a cell, the headers, or a selected range from result grids.
- `CREATE FUNCTION` / `CREATE PROCEDURE` stay one cell (no split on a bare `END`).
- Safe mode no longer asks for confirmation on `SELECT` / `JOIN` reads.
- Compare Data **Backup** restore uses the destination connection (it no longer
  writes into a snapshot).
- Node code cells (`-- @node` / `-- @nodets`) block `import()` / `eval` /
  `Function` / `.constructor` breakouts.

### Schema & utilities

- One table blueprint in Compare, Browse, History, and Edit table.
- **Browse** is its own Schema Sync pane.
- Index fragmentation: Postgres uses `pgstatindex` where available; MariaDB is
  its own family (not MySQL); SQLite credentials are selectable again.

### Dialects

- **Db2:** `REORG` after `DROP COLUMN`; skip `SYS%` roles; “Include identity”
  no longer emits a clause Db2 LUW does not have.
- **Oracle:** `NUMBER(p,0)` maps by precision (no silent int narrowing);
  `NOCYCLE` / `NOCACHE`; sequences created before the tables that use them;
  `DROP INDEX` / `DROP TRIGGER` tolerate objects that are already gone.

### Credentials

- MongoDB and Redis appear in the dialect list. The provider filter lists every
  dialect, not only ones you already saved.

---

## How to update

```bash
npm install -g foxschema@latest
foxschema stop && foxschema
```

Or Homebrew (after the formula bumps):

```bash
brew update && brew upgrade foxschema
foxschema stop && foxschema
```

Docker (this tag is already on Hub / GHCR):

```bash
docker pull 5nickels/foxschema:v0.2.111
# or: docker pull ghcr.io/tedious-code/foxschema:v0.2.111
```

Then hard-refresh the browser tab (Cmd/Ctrl-Shift-R).

### Run from git (before npm is published)

```bash
git clone https://github.com/tedious-code/foxschema.git
cd foxschema && git checkout main && git pull
npm install && npm run dev
# open http://localhost:5173
```
