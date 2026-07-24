# Winget / Windows install

## Install (current)

Desktop MSI packages are **retired**. On Windows, install Node then the CLI:

```powershell
winget install OpenJS.NodeJS.LTS
npm install -g foxschema
foxschema
foxschema shortcut        # Fox Schema shortcut on your Desktop
```

Requires [Node.js ≥ 22.5](https://nodejs.org/).

Also: Docker `5nickels/foxschema:latest` (linux/amd64, includes Db2) for servers —
see [INSTALL.md](INSTALL.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Retired winget packages

These IDs are frozen (no new versions). Prefer npm above.

| Package | Moniker | Status |
|---------|---------|--------|
| `TediousCode.FoxSchema` | `foxschema` | Retired (last MSI only) |
| `TediousCode.FoxSchema.DB2` | `foxschemadb2` | Retired — one product now |

`.github/workflows/winget.yml` is a no-op.

## Future

A single winget package that wraps the npm CLI may return later. Until then, use npm.
