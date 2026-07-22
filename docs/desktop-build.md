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

Prerequisites everywhere: **Node ≥ 22.5** (22 LTS preferred; matches CI), **Rust
(stable)** via [rustup](https://rustup.rs/), repo deps installed (`npm install` at the
repo root). Install native modules **on the target OS** — do not copy `node_modules`
across machines.

### macOS
```bash
cd apps/desktop && npm run build          # → .dmg / .app for the host arch
```
- `macos-latest` runners build **Apple Silicon**; use an Intel Mac (or `macos-13` in CI)
  for the **x86_64** build. A universal binary would need a universal sidecar Node — not
  set up yet.

### Windows

Extra prerequisites (on top of Node + Rust):

| Tool | Why |
|------|-----|
| **Visual Studio Build Tools** with **“Desktop development with C++”** (MSVC) | Links the Rust/Windows binary (`link.exe`) |
| **WebView2** runtime | UI shell (usually already present on Windows 10/11) |
| **WiX Toolset v3** (optional) | Needed for the `.msi` bundle; NSIS `.exe` still builds without it |

Put `%USERPROFILE%\.cargo\bin` on your PATH so `rustc` / `cargo` work in PowerShell.
Use the **MSVC** toolchain (`x86_64-pc-windows-msvc` / `aarch64-pc-windows-msvc`), not
MinGW. Prefer a short clone path (e.g. `C:\src\foxSchema`) — long paths still bite
Cargo/Tauri on some setups.

```powershell
# from repo root
npm install

cd apps\desktop
npm run build                             # → .msi (WiX) and .exe (NSIS)
```

Dev loop (no installer):

```powershell
cd apps\desktop
npm run dev
```

**Standard build (default):** all dialects except DB2. Prefer this first when validating
a new Windows machine.

**DB2 variant** (ibm_db + clidriver):

```powershell
$env:INCLUDE_DB2 = "1"
npx tauri build --config src-tauri\tauri.db2.conf.json
```

Outputs: `apps\desktop\src-tauri\target\release\bundle\`.

#### Windows troubleshooting

1. **MSVC / `link.exe` not found** — Install VS Build Tools “Desktop development with
   C++”, open a **new** “x64 Native Tools” or Developer PowerShell, then rebuild.
2. **`Failed to copy external binaries` / missing
   `foxschema-sidecar-*-pc-windows-msvc.exe`** — Sidecar step failed or `rustc` was not
   discoverable when naming the host triple. Confirm `rustc -vV` prints
   `host: …-pc-windows-msvc`, then run `npm run build:sidecar` alone under
   `apps\desktop`.
3. **Native driver rebuild fails** (`better-sqlite3`, `@duckdb/node-api`, or `ibm_db`
   with `INCLUDE_DB2=1`) — Delete `node_modules` and re-run `npm install` **on Windows**.
   Do not reuse a macOS/Linux `node_modules` tree. Prefer the standard (non-DB2) build
   first.
4. **WiX / MSI errors** — Install WiX Toolset v3, or use the NSIS `.exe` from the same
   bundle folder if MSI is not required.
5. **Path length / spaces** — Move the repo to a short path such as `C:\src\foxSchema`.
6. **GNU/MinGW toolchain by mistake** — Switch to the default rustup MSVC target
   (`*-pc-windows-msvc`).
7. **SmartScreen after a successful build** — Expected while unsigned (More info →
   Run anyway). Not a build failure.

#### Easier alternatives (no local Windows toolchain)

- Download a Windows installer from a **GitHub Release** (CI builds `.msi` / `.exe` on
  `windows-latest`).
- Trigger **Actions → Desktop Release → Run workflow**, or push a `v*` tag.
- Run the **web edition** only: from the repo root, `npm run dev` (no Rust/MSVC).

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
