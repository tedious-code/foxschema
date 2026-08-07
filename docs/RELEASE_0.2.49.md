# Fox Schema 0.2.49 — What's new

> **For users:** this is the page the in-app update toast links to (**What's new**).
> **Status:** not published yet — tag / npm / Docker / Homebrew ship when maintainers
> merge the release branch. Until then the in-app checker still shows older npm latest.

Covers everything since **`v0.2.36`**.

---

## What's new

### Compare & migrate data (side-by-side)

- **Compare data** across credentials with colored cell diffs.
- **Key alignment** so rows pair by the keys you care about (not only row order).
- **Keys picker** — choose which columns define a match; values follow.
- **Sync column** on the destination grid (on by default) — uncheck rows to skip.
- **Sync all** + **Migrate** respect op filters ∩ your Sync checkboxes (≤500 ops).
- Insert / delete rows tint **both** grids (including name-only keys).
- Side-by-side grids **scroll together** and **share the hovered row**.

### SQL Editor

- Edit data in query result grids (add / edit / clone / delete) when the PK is present.
- Schema explorer pinned at the top of the sidebar.
- `@faker-js/faker` allowed in code cells.
- Column picker alias fix + validated Data Peek row form.
- Safer code-cell queries and Peek integer handling; Safe Mode skips INSERT.

### Access & migrate correctness

- RBAC enforced on Data grid writes.
- Data migrate key / identity / auth fixes.

### Ports

- Default API / Docker port is now **3210** (same as the CLI), away from the busy
  **3000/3001** band. Override with `PORT` / `API_PORT` / `foxschema open --port`.
- CLI **`foxschema open`** auto-picks the next free port (3211+) when 3210 is taken
  by another app (unless you pass an explicit `--port`).

---

## How to update (no terminal required)

If you installed with **npm** and open Fox Schema via **`foxschema`** / **`foxschema open`**:

1. When a newer version is on npm, the UI shows an **Update available** toast
   (also under the profile menu and **User Preference**).
2. Click **What's new** to open this release page.
3. Click **Update now** — Fox Schema runs `npm install -g foxschema@latest` for you,
   restarts the UI on the same port, and reloads the browser tab.  
   You do **not** need to open a terminal or type the command yourself.

| Where you see it | What to click |
|------------------|---------------|
| Boot toast | **Update now** (or **What's new**) |
| Profile menu | **Update available · v…** → release page; open Preferences for the button |
| User Preference → Updates | **Update now** |

**Update now** is available when:

- You run the local CLI UI (`foxschema open` sets self-update on), and
- You are **not** in Docker / a locked-down multi-user server.

If **Update now** is hidden, use **Copy command** and paste into a terminal, or
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

## Distribution (after publish)

| Channel | Artifact |
|---------|----------|
| **npm** | `foxschema@0.2.49` |
| **Docker Hub** | `5nickels/foxschema:v0.2.49` / `:latest` |
| **GHCR** | `ghcr.io/tedious-code/foxschema:v0.2.49` |
| **Homebrew** | `Formula/foxschema.rb` → 0.2.49 (after npm) |
| **Release page** | https://github.com/tedious-code/foxschema/releases/tag/v0.2.49 |

---

## Branch policy (maintainers)

| Branch | Role |
|--------|------|
| `main` | Ongoing development |
| `cursor/release-0-2-49-2d53` | Release freeze — **do not publish until ready** |

This file is the **GitHub Release body** (`gh release create … --notes-file`). After
publish, the in-app **What's new** link opens that release page.

## Publish checklist (deferred)

See [PUBLISH.md](PUBLISH.md). When intentionally shipping:

```bash
git tag v0.2.49
git push origin v0.2.49
gh release create v0.2.49 --title "v0.2.49" --notes-file docs/RELEASE_0.2.49.md

# After npm shows 0.2.49:
./packaging/homebrew/update-formula.sh 0.2.49
git add Formula/foxschema.rb
git commit -m "brew: foxschema 0.2.49"
git push
```
