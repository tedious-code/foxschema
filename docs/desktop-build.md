# Building & publishing the Fox Schema desktop app

The desktop app is **Tauri v2** (Rust shell) wrapping the web UI, with the backend running
as a **Node sidecar** that Tauri spawns. Because the sidecar is a native binary and the
`keyring` crate uses each OS's secret store, the app must be **built on each target OS** —
there is no single cross-compile.

Supported targets: **macOS** (Apple Silicon + Intel), **Windows**, **Linux** (Ubuntu/Debian).

## What a build produces

`cd apps/desktop && npm run build` runs, in order:
1. `build:sidecar` — esbuilds the backend to an ESM `server.mjs` and copies a Node runtime
   binary named with the Rust **host triple** (Tauri picks it up as `externalBin`).
2. `build:frontend` — Vite build of the web UI into `src-tauri/frontendDist`.
3. `tauri build` — compiles the Rust shell and bundles installers.

Both (1) and (2) are wired into `tauri.conf.json` → `beforeBuildCommand`, so a plain
`tauri build` (or CI's `tauri-action`) does the whole thing.

Output installers land in `apps/desktop/src-tauri/target/release/bundle/`:

| OS | Artifacts |
|----|-----------|
| macOS | `.app`, `.dmg` |
| Windows | `.msi` (WiX), `.exe` (NSIS) |
| Linux | `.deb`, `.AppImage` (and `.rpm`) |

> **DB2** is excluded from the bundle by default (`INCLUDE_DB2=1` to opt in) — the
> clidriver's loose files trip Tauri's resource walker. The other 9 dialects are included.
>
> `ibm_db` has **no Apple Silicon build** — a DB2-enabled macOS build must target Intel
> even on an M-series Mac:
> ```bash
> rustup target add x86_64-apple-darwin   # once
> cd apps/desktop
> INCLUDE_DB2=1 npx tauri build --target x86_64-apple-darwin
> ```
> `build:sidecar` reads Tauri's `TAURI_ENV_PLATFORM`/`TAURI_ENV_ARCH` (set for
> `beforeBuildCommand` whenever `--target` cross-compiles) to name the sidecar for the
> **target**, not the machine's native host — otherwise the bundler fails with `Failed to
> copy external binaries: resource path 'binaries/foxschema-sidecar-x86_64-apple-darwin'
> doesn't exist` (it shipped a `-aarch64-` sidecar while looking for `-x86_64-`).

## Automated releases (CI)

`.github/workflows/desktop-release.yml` runs **cargo audit** first (hard-block on
RustSec advisories; ignores in `apps/desktop/src-tauri/.cargo/audit.toml`), then
builds all platform × variant targets in parallel and attaches the installers to a
**draft** GitHub Release.

```bash
# tag a version and push it — CI builds macOS(arm+intel)/Windows/Linux and drafts a release
git tag v0.1.0
git push origin v0.1.0
# …then review the draft Release on GitHub and hit Publish.
```

You can also run it manually from the **Actions → Desktop Release → Run workflow** button.

When the release is published (CI auto-publishes after all builds succeed), the
`release: published` event triggers:

- `.github/workflows/release-checksums.yml` — uploads `SHA256SUMS.txt` to the release
- `.github/workflows/winget.yml` — opens winget-pkgs PRs for both Windows MSI variants
  (requires repo secret `WINGET_TOKEN`; see `docs/winget.md`)

## Local builds (per OS)

Prerequisites everywhere: **Node 22+**, **Rust (stable)**, repo deps installed (`npm install`
at the repo root).

### macOS
```bash
cd apps/desktop && npm run build          # → .dmg / .app for the host arch
```
- `macos-latest` runners build **Apple Silicon**; use an Intel Mac (or `macos-13` in CI)
  for the **x86_64** build. A universal binary would need a universal sidecar Node — not
  set up yet.

### Windows
```powershell
cd apps/desktop; npm run build            # → .msi and .exe
```
- Needs the **WebView2** runtime (present on Windows 10/11 by default) and the MSVC build
  tools (Visual Studio Build Tools / "Desktop development with C++").

### Ubuntu / Debian
```bash
sudo apt-get update && sudo apt-get install -y \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
  librsvg2-dev libsecret-1-dev build-essential libssl-dev patchelf
cd apps/desktop && npm run build          # → .deb and .AppImage
```
- `libsecret-1-dev` is required for the keyring; at **runtime** the machine needs a Secret
  Service (gnome-keyring / KWallet) for the encryption key to be stored.

## Code signing / notarization

- **macOS**: `signingIdentity: "-"` in `tauri.conf.json` ad-hoc signs the app (free, no
  Apple Developer account) — this avoids the scarier "*App* is damaged and can't be
  opened" message that unsigned apps get on modern macOS. It still isn't
  Developer-ID-signed/notarized though, so first launch shows Gatekeeper's
  "unidentified developer" prompt: right-click the app → **Open**. **If a user still
  sees the "damaged" message** (e.g. from a build made before ad-hoc signing was added,
  or if the signature was stripped in transit), the fix is `xattr -cr "/Applications/Fox
  Schema.app"` in Terminal, then open normally.
  - `com.apple.quarantine` is applied recursively to every file inside the `.app` when
    it's downloaded via a browser — including the bundled Node **sidecar** binary, not
    just the top-level executable. Approving the main app via right-click → Open does
    **not** always clear it from nested binaries, so the sidecar can still fail to
    launch on first run. This surfaces as `"Could not read the selected database to
    verify it."` on the setup screen (the sidecar's `--check-install-binding` check
    exiting non-zero) — same fix: `xattr -cr "/Applications/Fox Schema.app"`, then
    reopen.
- **Windows**: unsigned — SmartScreen shows **More info → Run anyway**. An Authenticode
  cert removes it.
- **Linux**: no signing needed.

For the smooth, warning-free experience on macOS (no Gatekeeper prompt at all) you need
a paid Apple Developer ID cert + notarization — add the certs/secrets to the repo and
pass them to `tauri-action` (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`,
`APPLE_TEAM_ID`), and drop the ad-hoc `signingIdentity` in favor of the real one. Same
for Windows via `WINDOWS_CERTIFICATE` + password. See the Tauri "Signing" docs.

## Devtools / inspector

Release builds are compiled **without** the Tauri `devtools` feature (`Cargo.toml`
`tauri = { features = [] }`), so the WebView inspector is not present in production. The
frontend also blocks the inspector's entry points (right-click "Inspect", F12, ⌘/Ctrl
combos) as defense-in-depth (`apps/web/src/frontend/lib/harden.ts`) — active only in the
packaged desktop build, never on web or in dev.
