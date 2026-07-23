# foxschema

CLI for [Fox Schema](https://foxschema.com) — compare database schemas, generate migrations, and run the local web UI.

## Install

```bash
npm install -g foxschema
# requires Node.js >= 22.5
```

Or with Homebrew:

```bash
brew tap tedious-code/foxschema
brew install foxschema
```

Or Docker (linux/amd64, includes Db2):

```bash
docker pull 5nickels/foxschema:latest
```

## Usage

```bash
foxschema                 # start local UI on :3210 and open your browser
foxschema stop            # stop the managed UI server
foxschema doctor          # environment + driver checks
foxschema compare --source a --target b
foxschema tui             # terminal UI
```

Data and encryption keys live under your user XDG dirs (`~/.config/foxschema`, `~/.local/share/foxschema` on Linux/macOS).

One npm package — Db2 (`ibm_db`) is an optional dependency (installs on supported platforms).

## License

Apache-2.0
