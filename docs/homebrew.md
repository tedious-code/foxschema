# Homebrew (Fox Schema CLI)

Install the CLI with Homebrew so `foxschema` opens the local web UI in your
browser. Arm64 and Intel Macs are both supported (npm installs native addons
for the host arch).

## Install

```bash
brew tap tedious-code/foxschema
brew install foxschema
foxschema
```

Opens **http://localhost:3210**.

Requires Node.js 22.5+ (the formula depends on Homebrew `node@22`).

## DB2

Not bundled. After install:

```bash
foxschema drivers install db2
```

Or use Docker: `5nickels/foxschema:db2-latest`.

## Maintainers

Formula source of truth in this repo: [`packaging/homebrew/`](../packaging/homebrew/).
See that README for tap updates after each npm release.
