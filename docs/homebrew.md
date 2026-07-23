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

One formula / one npm package. Db2 (`ibm_db`) is an optional dependency of the
npm package (installs on supported platforms). Docker
`5nickels/foxschema:latest` includes Db2 on linux/amd64.

## Maintainers

Formula source of truth in this repo: [`packaging/homebrew/`](../packaging/homebrew/).
See that README for tap updates after each npm release.
