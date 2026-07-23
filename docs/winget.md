# Publishing Fox Schema to winget

## Status: desktop MSI channel retired

Fox Schema no longer publishes Tauri desktop installers. The previous winget
packages are **frozen** (no new versions):

| Package | Moniker | Status |
|---------|---------|--------|
| `TediousCode.FoxSchema` | `foxschema` | Retired (last MSI releases only) |
| `TediousCode.FoxSchema.DB2` | `foxschemadb2` | Retired — use the single product |

## Windows install (current)

```bash
npm install -g foxschema
foxschema
```

Requires [Node.js ≥ 22.5](https://nodejs.org/).

Also available: Docker `5nickels/foxschema:latest` (linux/amd64, includes Db2).

## Future

A single winget package wrapping the npm CLI (portable / nested installer) may
replace the MSI channel. Until then, use npm on Windows. The
`.github/workflows/winget.yml` workflow is a no-op.
