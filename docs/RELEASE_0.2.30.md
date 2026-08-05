# Fox Schema 0.2.30

Ship cut for **npm · Docker · Homebrew**. Covers everything since **`v0.2.16`**
(current public Latest). Intermediate `0.2.17`–`0.2.29` were auto-bumps on `main`.

## Highlights

- **Server Beam** — run SQL across two Destinations with `sql.on` mapping;
  source/target visibility, alias guards, and `MAX_SQL` caps hardened on all
  bridge paths (#158–#160, #164).
- **SQL Editor safety & UX** — WHERE warnings, sortable sidebar, recent queries,
  keyboard shortcuts (#167); Index Management fragmentation % aligned with Edit
  Table (#166).
- **Data Peek** — clear FK key filters to query the whole table; session
  password sharing between Sync and SQL Editor; tab close and credential
  save-password fixes (#169).
- **Security** — close RBAC read/write bypasses (batches, PRAGMA, code-fence
  disguised SQL) (#161, #165).
- **E2E** — Utilities harness timeout scaled for multi-dialect runs (#168).
- **Marketing** — first-open **email subscription** wizard only
  (`SIGNUP_WEBHOOK_URL`); onboarding survey answers stay local preferences.

## Seamless upgrade (from 0.2.16)

1. Keep the Docker `/data` volume (or metadata DB path) and a stable
   `APP_ENCRYPTION_KEY`.
2. Update, then run:

   ```bash
   foxschema stop && foxschema open
   ```

   On **0.2.16+**, `foxschema open` usually restarts a stale server for you;
   `stop` first is still the safe recovery if anything looks stuck.
3. No credential re-entry when the encryption key is unchanged.

## Distribution

| Channel | Artifact |
|---------|----------|
| **npm** | `foxschema@0.2.30` |
| **Docker Hub** | `5nickels/foxschema:v0.2.30` / `:latest` |
| **GHCR** | `ghcr.io/tedious-code/foxschema:v0.2.30` |
| **Homebrew** | `Formula/foxschema.rb` → 0.2.30 (after npm) |

## Install / update

```bash
npm install -g foxschema@0.2.30
# or
brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
brew trust tedious-code/foxschema
brew upgrade foxschema
# or
docker pull 5nickels/foxschema:v0.2.30
```

```bash
foxschema stop && foxschema open
foxschema doctor
```

Docker: restart with the **same** `/data` volume.

## Publish checklist (maintainers)

See [PUBLISH.md](PUBLISH.md). Short path:

```bash
git fetch origin main && git checkout main && git pull
# package.json should be 0.2.30
git tag v0.2.30
git push origin v0.2.30
gh release create v0.2.30 --title v0.2.30 --notes-file docs/RELEASE_0.2.30.md

# If tag workflows did not start:
gh api -X POST repos/tedious-code/foxschema/dispatches \
  -f event_type=ship-release \
  -f 'client_payload[tag]=v0.2.30'

# After npm shows 0.2.30:
./packaging/homebrew/update-formula.sh 0.2.30
git add Formula/foxschema.rb
git commit -m "brew: foxschema 0.2.30"
git push origin main
```

Verify:

```bash
npm view foxschema version          # 0.2.30
docker pull 5nickels/foxschema:v0.2.30
npm install -g foxschema@latest && foxschema doctor
```
