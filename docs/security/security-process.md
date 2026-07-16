# Security Process

CI security architecture and maintenance guide for FoxSchema contributors.

---

## Pipeline Overview

```
Pull Request opened / pushed
        │
        ├─► dependency-security.yml
        │     ├─ npm audit --audit-level=critical  ←── HARD BLOCK
        │     ├─ npm audit --audit-level=high      ←── warn only
        │     ├─ ESLint security rules             ←── HARD BLOCK on error
        │     └─ cargo audit                       ←── HARD BLOCK
        │
        └─► secret-scan.yml (diff mode)            ←── HARD BLOCK

Push to main / Weekly Monday 01:00 UTC
        └─► secret-scan.yml (full history)

Push to main / Weekly Monday 02:00 UTC
        └─► codeql.yml → GitHub Security tab

Tag push  v*
        ├─► release-gate.yml
        │     ├─ unit tests
        │     ├─ ESLint security
        │     ├─ npm audit critical
        │     ├─ Gitleaks full scan
        │     └─ cargo audit
        │     └─ [if all pass] → GitHub Release draft
        │
        └─► desktop-release.yml
              ├─ cargo audit                       ←── HARD BLOCK (gates builds)
              ├─ matrix builds (macOS / Windows / Linux × standard|db2)
              └─ [if all pass] → publish release
```

---

## Workflow Details

### `dependency-security.yml`

| Check | Failure behavior | Notes |
|-------|-----------------|-------|
| `npm audit --audit-level=critical` | Blocks PR | Production deps only (`--omit=dev`) |
| `npm audit --audit-level=high` | Warning only | devDep false positives are common |
| ESLint security rules | Blocks PR | `--max-warnings 0` enforced |
| `cargo audit` | Blocks PR | Covers Tauri desktop Rust deps |

**Why `--omit=dev` for critical?** Test tools (vitest, selenium-webdriver, esbuild) often carry high/critical advisories for code paths that are never reachable in production. Without `--omit=dev`, false positives block developer PRs for issues with no real attack surface.

**Why not `--omit=dev` for the high check?** The soft warning runs without `--omit=dev` so developers see the full picture in the artifact report.

**Lockfile note:** `package-lock.json` is currently gitignored. The workflow generates it with `npm install --package-lock-only --ignore-scripts`. For more reliable and faster audits, commit the lockfile. Remove `package-lock.json` from `.gitignore` and run `npm install` once locally.

### `secret-scan.yml`

Uses [Gitleaks](https://github.com/gitleaks/gitleaks) v8, pinned to a specific version for reproducibility.

- **PR runs:** `--log-opts "origin/main...HEAD"` — scans only commits introduced by the PR. Fast (~5 s).
- **Push/schedule runs:** full repository history scan. Slower (~30 s).

Findings are uploaded as SARIF to the GitHub Security tab.

**Allowlisted paths:** `apps/e2e/.env` — local Docker dev credentials, explicitly labelled non-production. See `.gitleaks.toml` for the full allowlist with rationale.

**Adding a new allowlist entry:**
```toml
# .gitleaks.toml
[allowlist]
  paths = [
    '''path/to/known-safe-file''',
  ]
```

Always document **why** the path is safe in the comment.

### `codeql.yml`

Runs on push to `main` and weekly on Monday at 02:00 UTC. Not a PR gate — CodeQL takes 5–15 minutes and would slow developer feedback loops unacceptably.

Detects:
- SQL injection (`security/sql-injection`)
- Path traversal (`security/path-injection`)
- Prototype pollution (`security/prototype-pollution`)
- Hardcoded credentials (`security/hardcoded-credentials`)
- Command injection (`security/command-injection`)

Findings appear in the [GitHub Security tab](../../security/code-scanning) automatically.

To dismiss a false positive: open the finding in the Security tab → mark as "False positive" with a justification. This persists across scans.

### `release-gate.yml`

Triggered by a tag push matching `v*`.

```bash
# Create and push a release tag
git tag v0.0.12
git push origin v0.0.12
```

If all 5 gates pass, a **draft GitHub Release** is created automatically with auto-generated release notes. Edit the draft in the GitHub UI, then publish.

If any gate fails: fix the issue, delete the tag, re-tag.

```bash
git tag -d v0.0.12
git push origin :refs/tags/v0.0.12
# fix the issue, then re-tag
git tag v0.0.12
git push origin v0.0.12
```

---

## ESLint Security Rules

Configured in `eslint.config.js` at the repo root.

| Rule | Severity | Detects |
|------|----------|---------|
| `security/detect-child-process` | error | `exec()`/`spawn()` with non-literal args |
| `security/detect-eval-with-expression` | error | `eval(expr)` / `new Function(expr)` |
| `security/detect-unsafe-regex` | error | Catastrophic backtracking (ReDoS) |
| `security/detect-non-literal-fs-filename` | warn | `fs.readFile(variable)` |

`security/detect-object-injection` is deliberately omitted — it fires on every `obj[key]` access and produces an extreme false-positive rate in the dialect/registry code.

To suppress a specific line (use sparingly, document why):
```ts
// eslint-disable-next-line security/detect-non-literal-fs-filename
fs.readFileSync(resolvedPath);  // resolvedPath is validated by validateFilePath() above
```

Run locally:
```bash
npm run lint           # warnings allowed (developer feedback)
npm run lint:security  # zero warnings (same as CI)
```

---

## Maintenance

### Updating Gitleaks version

1. Check [Gitleaks releases](https://github.com/gitleaks/gitleaks/releases) for a new version.
2. Update `GITLEAKS_VERSION` in `.github/workflows/secret-scan.yml` and `.github/workflows/release-gate.yml`.
3. Test locally: `docker run --rm -v $(pwd):/repo ghcr.io/gitleaks/gitleaks:v8.21.2 detect --source /repo`.

### Responding to a npm audit finding

1. Check if the vulnerable package is a direct or transitive dependency: `npm why <package>`.
2. If it's a devDependency with no production attack surface, add a note and keep the `--omit=dev` flag.
3. If it's a production dependency: update via `npm update <package>` or pin a safe version in `package.json`.
4. If no fix exists: open a GitHub advisory discussion and add a risk-accepted comment in the PR.

### Responding to a Gitleaks finding

Real secret found:
1. **Rotate the secret immediately** — assume it is compromised.
2. Remove from git history: `git filter-repo --path <file> --invert-paths` (or BFG Repo Cleaner).
3. Force-push and notify all team members to re-clone.

False positive:
1. Add to `.gitleaks.toml` allowlist with a rationale comment.
2. Never add a broad regex that could suppress real findings.

### Responding to a CodeQL finding

1. Open the finding in the GitHub Security tab.
2. If real: create a fix PR. Reference the CodeQL alert ID in the PR body.
3. If false positive: click "Dismiss alert" → "False positive" → add justification text.
   CodeQL won't re-surface dismissed alerts on future scans.
