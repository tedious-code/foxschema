# Publishing Fox Schema to winget

## Package IDs

| Variant | PackageIdentifier | Moniker | Install command | Windows installer |
|---------|-------------------|---------|-----------------|-------------------|
| Standard (no DB2) | `TediousCode.FoxSchema` | `foxschema` | `winget install foxschema` | `Fox.Schema_<ver>_x64_en-US.msi` |
| DB2 | `TediousCode.FoxSchema.DB2` | `foxschemadb2` | `winget install foxschemaDb2` | `Fox.Schema.DB2_<ver>_x64_en-US.msi` |

Manifest path in [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs):
`manifests/t/TediousCode/FoxSchema/<version>/` and `FoxSchema/DB2/<version>/`.

Reference manifests (for manual first submit / local edits) live under
`packaging/winget/` in this repo.

## Automated updates (CI)

`.github/workflows/winget.yml` runs when **Desktop Release** publishes a version
tag (`release: published` — same event as checksums). It opens winget-pkgs PRs
for both packages via [vedantmgoyal9/winget-releaser](https://github.com/vedantmgoyal9/winget-releaser).

### One-time setup

1. Classic GitHub PAT with `public_repo` (fine-grained tokens are **not** supported).
2. Add it as repo secret **`WINGET_TOKEN`** (Settings → Secrets → Actions).
3. Keep a fork of `microsoft/winget-pkgs` under **`huyplb`** (matches `fork-user` in the workflow). Sync the fork periodically if needed.
4. At least **one** version of each package must already be merged in winget-pkgs
   (the action templates from the latest). Seed manually for the first release;
   later tags are automatic.

### Manual retry / backfill

```bash
gh workflow run winget.yml -f tag=v0.1.45
```

## Manual submit (first version only)

1. Confirm the GitHub Release is **published** and includes the MSI.
2. Compute SHA256:

```bash
VERSION=0.1.45
MSI_URL="https://github.com/tedious-code/foxschema/releases/download/v${VERSION}/Fox.Schema_${VERSION}_x64_en-US.msi"
SHA=$(curl -sL "$MSI_URL" | shasum -a 256 | awk '{print toupper($1)}')
echo "$SHA"
```

3. Copy `packaging/winget/TediousCode.FoxSchema/<version>/` (or `.DB2`) into the
   fork, bump `PackageVersion` / `InstallerUrl` / `InstallerSha256` /
   `ReleaseNotesUrl`, then open a PR to `microsoft/winget-pkgs`.

## Notes

- Prefer **MSI (WiX)** over the NSIS `-setup.exe` for winget.
- Unsigned builds are allowed in the community repo; SmartScreen may still warn.
- winget does **not** bypass Windows Defender / SmartScreen.
