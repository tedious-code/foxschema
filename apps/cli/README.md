# foxschema

CLI for [Fox Schema](https://foxschema.com) — compare database schemas, generate migrations, and run the local web UI.

## Install

```bash
npm install -g foxschema
# requires Node.js >= 22.5
```

Or with Homebrew (after tapping):

```bash
brew install tedious-code/foxschema/foxschema
```

## Usage

```bash
foxschema                 # start local UI on :3210 and open your browser
foxschema stop            # stop the managed UI server
foxschema doctor          # environment + driver checks
foxschema compare --source a --target b
foxschema tui             # terminal UI
foxschema drivers install db2   # opt-in DB2 driver (large)
```

Data and encryption keys live under your user XDG dirs (`~/.config/foxschema`, `~/.local/share/foxschema` on Linux/macOS).

## DB2

Not included by default. Install with `foxschema drivers install db2`, or use the Docker image `5nickels/foxschema:db2-latest`.

## License

Apache-2.0
