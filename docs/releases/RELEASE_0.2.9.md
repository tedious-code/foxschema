# Fox Schema 0.2.9 — feature update

Notes for upgrading from **0.2.4** (current npm/Homebrew Latest) through **0.2.9**.

## Seamless upgrade

1. **Keep your data volume** (`/data` in Docker, or `APP_DB_*` / local metadata path).
2. **Keep `APP_ENCRYPTION_KEY` stable** (Docker reuses `/data/.app_encryption_key`).
3. Boot once — metadata migrations apply automatically:
   - existing users become **admin**
   - the first-open signup wizard stays suppressed on used installs
4. Reopen the UI — SQL Editor tabs/bookmarks/variables rehydrate from the same
   `foxschema-sql-editor` localStorage key.

No credential re-entry is required when the encryption key is unchanged.

## What’s new since 0.2.4

- **Utilities → Query files** — CSV/TSV, JSON/NDJSON, fixed-width text → temp
  `Files:` SQLite workspaces or bulk-load into a saved credential; Files sidebar
- **Utilities → Server Insights** — pool / sessions / sizes (dialect probes)
- **Editable Data Peek** — add / edit / clone / delete (permission-gated)
- **RBAC** — `admin` / `editor` / `viewer` + Access control (multi-user mode)
- **CockroachDB** — generate-time dependent DROP/CREATE around structural ALTER
  (web + CLI)
- **Desktop (Tauri) retired** — use `foxschema` CLI + browser, or Docker

## Install / update

```bash
npm install -g foxschema@latest
# or
docker pull 5nickels/foxschema:latest
# or
brew upgrade foxschema
```

Then `foxschema` (or restart the Docker container with the same `/data` volume).
