# Fox Schema 0.2.81 — What's new

> **For users:** this is the page the in-app update toast links to (**What's new**).

Since **`v0.2.73`** (last npm/Homebrew publish). Includes Lokee Weave and related work landed on `main`.

---

## What's new

### Lokee Weave

- New **Workspace** tab: **Lokee Weave** (schema version graph).
- Capture schema from a saved credential; filter by version / status / date / user.
- Edit a version’s **display name** and **description**.

### SQL Editor security

- Node code cells (`-- @node` / `-- @nodets`) block dynamic `import()` / `eval` /
  `Function` / `.constructor` breakouts (no host shell, fs, or secret env via the cell).
- Scrubbed worker env + authenticated SQL bridge tokens.

### Compare Data

- **Backup** setting (default on) with restore on partial migrate failure / History.

### Credentials

- MongoDB and Redis in the dialect list; provider filter lists all dialects.
- IBM DB2 remains available.

### Toolbar

- Workspace switcher is on its own full-width row so Lokee Weave stays visible
  in narrow windows.

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

Then hard-refresh the browser tab (Cmd/Ctrl-Shift-R).

### Run from git (before npm is published)

```bash
git clone https://github.com/tedious-code/foxschema.git
cd foxschema && git checkout main && git pull
npm install && npm run dev
# open http://localhost:5173
```
