# foxschema

CLI for [Fox Schema](https://foxschema.com) — compare database schemas, generate migrations, and run the local web UI.

## Install

Requires **Node.js ≥ 22.5**. Full matrix: [docs/INSTALL.md](../../docs/INSTALL.md).

```bash
npm install -g foxschema

# Homebrew (macOS — formula in this repo; Homebrew 6+ needs trust once)
brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
brew trust tedious-code/foxschema
brew install foxschema

# Windows: winget install OpenJS.NodeJS.LTS  then  npm i -g foxschema

# Docker (servers, linux/amd64, includes Db2)
docker pull 5nickels/foxschema:latest
```

## Usage

```bash
foxschema                 # start local UI on :3210 and open your browser
foxschema stop            # stop the managed UI server
foxschema shortcut        # Fox icon on your Desktop (reopens UI anytime)
foxschema doctor          # environment + driver checks
foxschema compare --source a --target b
foxschema tui             # terminal UI
```

Data and encryption keys live under your user XDG dirs (`~/.config/foxschema`, `~/.local/share/foxschema` on Linux/macOS).

One npm package — Db2 (`ibm_db`) is an optional dependency (installs on supported platforms).
Maintainers: [docs/PUBLISH.md](../../docs/PUBLISH.md).

## License

Apache-2.0
