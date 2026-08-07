# Fox Schema 0.2.49

**Status: not published.** This is a release-branch freeze only. Do **not** tag
`v0.2.49` or ship npm / Docker / Homebrew until maintainers merge and publish.

Covers everything since **`v0.2.36`** (main auto-bumps `0.2.37`–`0.2.48` plus
Compare UX on this branch). `main` continues independently; merge this branch
when ready to publish.

## Highlights

- **Compare data (side-by-side)** — colored cell diffs across credentials; key
  alignment for friendlier row pairing; Data migrate (≤500 ops) from compare.
- **Compare Keys / Sync UX** — interactive Keys picker; destination Sync
  checkboxes (default on) ∩ op filters; Sync all; dual-grid insert/delete tints
  (including name-only keys / duplicate-key first-wins).
- **Synced scroll + hover** — side-by-side grids lock vertical scroll by pixel
  and share hovered row index without React lag.
- **Result grid editing** — add / edit / clone / delete on single-table SELECT
  results (RBAC-aware); Data Peek row form validation; column picker alias fix.
- **SQL Editor** — Schema pinned at top of sidebar; `@faker-js/faker` in code
  cells; Safe Mode skips INSERT; write CTE paging fix; oversized code-cell
  query fail-closed; Peek unsafe-integer preservation.
- **Data migrate correctness** — keys, identity, and auth fixes on the migrate
  path.

## Seamless upgrade (from 0.2.36+)

1. Keep the Docker `/data` volume (or metadata DB path) and a stable
   `APP_ENCRYPTION_KEY`.
2. After publish, update, then run:

   ```bash
   foxschema stop && foxschema open
   ```

3. No credential re-entry when the encryption key is unchanged.

## Distribution (after publish)

| Channel | Artifact |
|---------|----------|
| **npm** | `foxschema@0.2.49` |
| **Docker Hub** | `5nickels/foxschema:v0.2.49` / `:latest` |
| **GHCR** | `ghcr.io/tedious-code/foxschema:v0.2.49` |
| **Homebrew** | `Formula/foxschema.rb` → 0.2.49 (after npm) |

## Branch policy

| Branch | Role |
|--------|------|
| `main` | Ongoing development (keep shipping PRs here) |
| `cursor/release-0-2-49-2d53` | Release freeze / ship candidate — **no publish yet** |

When ready to ship: merge this branch → `main` (or tag from this tip), then
follow the publish checklist. Until then, leave tags and ship workflows alone.

## Publish checklist (maintainers) — deferred

See [PUBLISH.md](PUBLISH.md). Short path **only when intentionally shipping**:

```bash
# From the release tip (or after merge to main):
git tag v0.2.49
git push origin v0.2.49
gh release create v0.2.49 --title v0.2.49 --notes-file docs/RELEASE_0.2.49.md

# After npm shows 0.2.49:
./packaging/homebrew/update-formula.sh 0.2.49
git add Formula/foxschema.rb
git commit -m "brew: foxschema 0.2.49"
git push
```
