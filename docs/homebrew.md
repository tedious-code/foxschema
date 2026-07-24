# Homebrew (Fox Schema CLI)

Install the CLI with Homebrew. Then open the local web UI or use the desktop shortcut.

Arm64 and Intel Macs are both supported (npm installs native addons for the host arch).

## Install

```bash
brew tap tedious-code/foxschema
brew install foxschema
foxschema                 # http://localhost:3210
foxschema shortcut        # Fox icon on your Desktop
foxschema stop
```

Requires Node.js 22.5+ (the formula depends on Homebrew `node@22`).

One formula / one npm package. Db2 (`ibm_db`) is an optional dependency (installs on
supported platforms). Docker `5nickels/foxschema:latest` includes Db2 on linux/amd64.

See also: [INSTALL.md](INSTALL.md) · maintainers: [PUBLISH.md](PUBLISH.md).

## Maintainers

Formula source of truth: [`packaging/homebrew/`](../packaging/homebrew/).
Update the tap after each npm release (see packaging README / PUBLISH.md).
