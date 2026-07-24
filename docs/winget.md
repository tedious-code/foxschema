# Winget / Windows install

## Install (after winget-pkgs merge)

```powershell
winget install TediousCode.FoxSchema
```

This installs the **CLI portable zip** (`foxschema.exe` / `fox.exe`) and depends on
**Node.js LTS** (`OpenJS.NodeJS.LTS`). Then:

```powershell
foxschema
foxschema shortcut
```

## Install (today — works before winget merge)

```powershell
winget install OpenJS.NodeJS.LTS
npm install -g foxschema
foxschema
```

## One package only

| Package | Status |
|---------|--------|
| `TediousCode.FoxSchema` | Active — CLI zip, moniker `foxschema` |
| `TediousCode.FoxSchema.DB2` | Retired — do not use |

## Maintainers

1. Tag a release (`v0.1.67`) or run **Publish to WinGet** (`workflow_dispatch`).
2. CI builds `foxschema-<ver>-win-x64.zip`, uploads it to the GitHub Release, and opens a
   PR on [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
3. Secret: `WINGET_TOKEN` — classic PAT (`public_repo`) for `huyplb` (fork of winget-pkgs).

Manifests live in [`packaging/winget/TediousCode.FoxSchema/`](../packaging/winget/TediousCode.FoxSchema/).
