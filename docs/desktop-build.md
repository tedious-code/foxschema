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

## Automated releases (CI)

`.github/workflows/desktop-release.yml` builds all four targets in parallel and attaches
the installers to a **draft** GitHub Release.

```bash
# tag a version and push it — CI builds macOS(arm+intel)/Windows/Linux and drafts a release
git tag v0.1.0
git push origin v0.1.0
# …then review the draft Release on GitHub and hit Publish.
```

You can also run it manually from the **Actions → Desktop Release → Run workflow** button.

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

## Code signing / notarization (not yet enabled)

Installers currently ship **unsigned**, so users see a first-run warning:
- **macOS**: right-click the app → **Open** (Gatekeeper). For distribution without the
  prompt you need an Apple Developer ID cert + notarization.
- **Windows**: SmartScreen → **More info → Run anyway**. An Authenticode cert removes it.
- **Linux**: no signing needed.

To enable signing later, add the certs/secrets to the repo and pass them to `tauri-action`
(`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` for macOS;
`WINDOWS_CERTIFICATE` + password for Windows). See the Tauri "Signing" docs.

## Devtools / inspector

Release builds are compiled **without** the Tauri `devtools` feature (`Cargo.toml`
`tauri = { features = [] }`), so the WebView inspector is not present in production. The
frontend also blocks the inspector's entry points (right-click "Inspect", F12, ⌘/Ctrl
combos) as defense-in-depth (`apps/web/src/frontend/lib/harden.ts`) — active only in the
packaged desktop build, never on web or in dev.
