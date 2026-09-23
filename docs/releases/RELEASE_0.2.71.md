# Fox Schema 0.2.71 — What's new

> **For users:** this is the page the in-app update toast links to (**What's new**).

Covers everything since **`v0.2.50`**.

---

## What's new

### SQL Editor — results & Compare

- **Maximize** on every result panel (By cred and Side-by-side), not only Compare.
  Fullscreen grids with **Close** / **Esc**.
- **Copy** result grids to the clipboard (TSV for Excel / Sheets), with optional
  headers, column chooser, and **Export JSON**. Right-click and Cmd/Ctrl-C work
  in the grid too.
- Clone-row and clipboard **Copy** use different icons so they are easy to tell apart.
- Side-by-side **running** state shows progress instead of a blank panel while a
  query is in flight (#214 / #215).
- One shared value normalizer for Compare, Keys, and grid writes — decimal-looking
  text keys stay exact for migrate.

### Schema compare

- Index **rename-only** diffs (same columns + uniqueness, different name) no longer
  mark the table as **MODIFY** in the left tree. They still appear in the schema
  blueprint so you can opt in to migrate.

### Drivers & install

- **Db2 / `ibm_db`**: install into `@foxschema/db` where `require()` actually runs,
  and run install scripts so the clidriver downloads (#205 / #217).

### File query & imports

- Streaming **CSV** reader with measured import capacity.
- Incremental **NDJSON** reader (no new dependency).
- Detect **text columns** instead of counting characters.
- Collect upload part files orphaned by a restart.

### Data migrate

- Identity **INSERT** shaped per dialect.
- Block Edit/Delete migrate when Compare Keys are not unique.

### Connections

- Connection settings for **Redis** and **MongoDB** (plus SQL-subset groundwork for
  non-SQL stores).

### Quality

- React component tests in jsdom (ResultsPanel / in-flight regression).
- ESLint gate green; React hooks linted for the first time.
- Shared modal backdrop class.

---

## How to update (no terminal required)

If you installed with **npm** and open Fox Schema via **`foxschema`** / **`foxschema open`**:

1. When a newer version is on npm, the UI shows an **Update available** toast
   (also under the profile menu and **User Preference**).
2. Click **What's new** to open this release page.
3. Click **Update now** — Fox Schema runs `npm install -g foxschema@latest` for you,
   restarts the UI on the same port, and reloads the browser tab.

| Where you see it | What to click |
|------------------|---------------|
| Boot toast | **Update now** (or **What's new**) |
| Profile menu | **Update available · v…** → release page; open Preferences for the button |
| User Preference → Updates | **Update now** |

If **Update now** is hidden (Docker / locked-down hosts), use **Copy command** or
upgrade your channel below.

### Other install channels

| You installed with | Upgrade with |
|--------------------|--------------|
| **npm** (CLI) | Prefer **Update now** in the UI; or `npm install -g foxschema@latest` |
| **Homebrew** | `brew update && brew upgrade foxschema` |
| **Docker** | `docker pull 5nickels/foxschema:latest` then recreate the container |

Keep your data volume / encryption key stable so saved connections stay readable.
Then: `foxschema stop && foxschema open` (or reopen Docker) and optionally
`foxschema doctor`.

---

## Distribution

| Channel | Artifact |
|---------|----------|
| **npm** | `foxschema@0.2.71` |
| **Docker Hub** | `5nickels/foxschema:v0.2.71` / `:latest` |
| **GHCR** | `ghcr.io/tedious-code/foxschema:v0.2.71` |
| **Homebrew** | `Formula/foxschema.rb` → 0.2.71 (after npm) |
| **Release page** | https://github.com/tedious-code/foxschema/releases/tag/v0.2.71 |
