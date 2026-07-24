# Publishing Fox Schema

How maintainers ship a release. **Users** should follow [INSTALL.md](INSTALL.md).

Distribution channels (one product, no separate Db2 edition):

| Channel | Artifact | Trigger |
|---------|----------|---------|
| **npm** | `foxschema` on registry.npmjs.org | `.github/workflows/npm-publish.yml` on `v*` tag |
| **Docker** | `5nickels/foxschema:latest` + `:vX.Y.Z` (linux/amd64, includes Db2) | `.github/workflows/web-release.yml` on `v*` tag |
| **Homebrew** | `Formula/foxschema.rb` in this repo | Manual commit after npm publish |
| **Winget** | `TediousCode.FoxSchema` portable zip on GitHub Releases | `.github/workflows/winget.yml` on release / dispatch |
| **Desktop Tauri** | **Retired** — do not publish | — |

Version numbers are bumped automatically on merge to `main`
(`.github/workflows/version-bump.yml`). Do **not** bump version in feature PRs.

---

## 1. Merge to `main`

CI bumps `0.1.N` → `0.1.N+1` (e.g. `0.1.66` → `0.1.67`).

---

## 2. Tag the release

Tag the commit that has the version you want to publish (usually the bump commit):

```bash
git fetch origin main
git checkout main && git pull
# package.json should show the new version, e.g. 0.1.67
git tag v0.1.67
git push origin v0.1.67
```

That starts:

- **Web Release** → Docker Hub + GHCR (`latest` and `v0.1.67`)
- **npm Publish** → needs repo secret `NPM_TOKEN`

Or run manually:

```bash
gh workflow run web-release.yml --ref v0.1.67
gh workflow run npm-publish.yml --ref v0.1.67
```

### Secrets

| Secret | Used by |
|--------|---------|
| `NPM_TOKEN` | npm publish (Automation token, publish rights on `foxschema`) |
| `DOCKERHUB_USERNAME` | Docker Hub push (`5nickels`) |
| `DOCKERHUB_TOKEN` | Docker Hub access token (read/write) |

---

## 3. Homebrew (same repo)

After npm shows `foxschema@VERSION`, update the formula in this repo and push:

```bash
./packaging/homebrew/update-formula.sh 0.1.67
git add Formula/foxschema.rb
git commit -m "brew: foxschema 0.1.67"
git push origin main
```

Users install with:

```bash
brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
brew trust tedious-code/foxschema
brew install foxschema
```

See [packaging/homebrew/README.md](../packaging/homebrew/README.md).

---

## 4. Verify

```bash
npm view foxschema version
docker pull 5nickels/foxschema:latest
npm install -g foxschema@latest
foxschema doctor
foxschema shortcut
```

---

## 5. What not to publish

- Do **not** run Desktop Release (retired).
- Do **not** publish separate `db2-latest` / `FoxSchema.DB2` packages.
- Do **not** open new winget MSI PRs for Tauri installers.

---

## Local dry-run (before tagging)

```bash
npm run build -w @foxschema/web
npm run build -w @foxschema/cli
node apps/cli/scripts/prepare-publish.mjs
# inspect apps/cli/npm-pack/ — do not npm publish unless intentional
```
