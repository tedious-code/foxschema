# Homebrew (Fox Schema CLI)

Formula lives in the **same** GitHub repo (`Formula/foxschema.rb`) — no separate tap repo.

Homebrew 6+ will not load third-party formulas until you **trust** the tap once
(official `homebrew/core` packages do not need this).

## Install

```bash
brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
brew trust tedious-code/foxschema
brew install foxschema
foxschema                 # http://localhost:3210
foxschema shortcut        # Fox icon on your Desktop
foxschema stop
```

One-liner:

```bash
brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema \
  && brew trust tedious-code/foxschema \
  && brew install foxschema
```

Requires Node.js 22.5+ (the formula depends on Homebrew `node@22`).

`brew search foxschema` / bare `brew info foxschema` only work **after** the tap
(and trust). Until then Homebrew only knows core formulas.

One formula / one npm package. Db2 (`ibm_db`) is an optional dependency (installs on
supported platforms). Docker `5nickels/foxschema:latest` includes Db2 on linux/amd64.

See also: [INSTALL.md](INSTALL.md) · maintainers: [PUBLISH.md](PUBLISH.md).

## Maintainers

After each npm release, refresh checksums with
[`packaging/homebrew/update-formula.sh`](../packaging/homebrew/update-formula.sh)
and commit `Formula/foxschema.rb` on `main`.
