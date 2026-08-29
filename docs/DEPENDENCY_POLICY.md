# Dependency policy

How this repository defends against a compromised npm package.

The threat is ordinary: an attacker takes over a package — often a small
transitive one — and publishes a patch release containing a credential stealer
or a build-time backdoor. Nothing about that release looks unusual, and semver
ranges install it automatically.

## What is in place

### The lockfile is committed

`package-lock.json` is tracked. It is the only thing that pins **transitive**
dependencies; `package.json` pins only the direct ones. Without it, every
install resolves fresh and a compromised release published an hour ago is
installed on the next CI run.

It was previously gitignored — inherited from a starter template rather than
chosen. That gap also caused two unrelated CI breakages in one month, when a
transitive release changed under a branch that had not been touched.

### CI installs with `--ignore-scripts`

`preinstall` / `postinstall` hooks never run in CI. Those hooks are the usual
payload location, and they execute before any test or scan sees the code.

This includes the publish and release workflows, which hold an npm token and
are therefore the worst place to run code a dependency chose. `build-gate`
builds the same artifacts with `--ignore-scripts`, so nothing needs them.

### Why not `npm ci` yet

`npm ci` would be stronger — it installs exactly the locked tree and fails when
the lockfile and `package.json` disagree — but it cannot be used here yet.

npm records a lockfile entry only for the platform binaries it actually
resolved (npm/cli#4828). A lockfile generated on macOS therefore has
`@tailwindcss/oxide-darwin-arm64` and no `@tailwindcss/oxide-linux-x64-gnu`,
and `npm ci` on a Linux runner fails with "Cannot find native binding". The
`optionalDependencies` for all twelve platforms are listed in the lockfile;
only the resolved *entries* are missing.

Generating the lockfile on Linux instead does not currently work either: a
from-scratch resolve of this workspace fails inside npm with
`Cannot read properties of null (reading 'edgesOut')` on both npm 10 and
npm 12.

The same asymmetry means the two platforms prune each other's entries: running
`npm install` on macOS deletes the `@emnapi/*` entries a Linux install added,
and vice versa. Expect small lockfile diffs from that until it is fixed; they
are noise, not a dependency change, and are worth checking rather than
committing blindly.

The fix is to produce the lockfile on a Linux runner and commit that artifact,
which needs a CI job rather than a local command. Until then CI uses
`npm install --ignore-scripts`, which honours the committed lockfile where it
can and fills in the platform binaries it needs.

### Every version is exact

No `^` or `~` in any `package.json`, including `overrides`. A dependency change
is a visible edit in a diff rather than a range that quietly widens. `.npmrc`
sets `save-exact=true` so `npm install <pkg>` keeps it that way.

Workspace links (`"@foxschema/sql": "*"`) are left alone — they resolve to the
local package, never to the registry.

### CI checks, in `dependency-security.yml`

| Check | Answers |
|---|---|
| `npm audit signatures` | Is this tarball the one the registry published? Catches tampering and re-publishing. |
| `npm audit --audit-level=critical` | Is this version known to be vulnerable? Fails the build. |
| `npm audit --audit-level=high` | Same, as a warning. |
| ESLint security rules | Does our own code do something unsafe? |
| `deps-backdoor-scan` | Does anything in `node_modules` open a port or shell out? Runs weekly as well as per-PR, to catch a delayed publish. |

## Upgrading a dependency

1. `npm install <pkg>@<exact-version>` — `.npmrc` writes the exact version.
2. Commit `package.json` **and** `package-lock.json` together, so the tree that
   was reviewed is the one recorded.
3. Read what changed. For a package you have not upgraded in a while, the
   release notes and the diff matter more than the version number.

Prefer waiting a few days after a release before taking it, unless it fixes
something that affects this project. Most malicious publishes are found and
unpublished within a day or two.

## Known exception: monaco-editor

`npm audit` reports four `dompurify` advisories reached through
`monaco-editor`, and offers to fix them with `npm audit fix --force`.

**Do not run that here.** It installs `monaco-editor@0.56.0`, which breaks the
frontend build — the root `overrides` pin `monaco-editor` to `0.55.1` for that
reason.

This is accepted risk, not a resolved issue. The advisories concern DOMPurify's
`IN_PLACE` and hook-configuration modes; whether any of them is reachable
through the editor as this application uses it has not been established either
way. Revisit when a monaco release ships a patched DOMPurify, or establish
reachability if the advisories escalate.
