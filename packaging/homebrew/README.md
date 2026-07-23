# Publishing Fox Schema to Homebrew

The CLI (`foxschema`) is installed via a Homebrew formula that wraps the
published npm package. That gives correct Arm64 and x86_64 native driver
binaries per machine without shipping a universal Tauri app.

## Install (users)

```bash
brew tap tedious-code/foxschema
brew install foxschema
foxschema
```

Requires Homebrew’s `node@22` (or newer Node 22+ on PATH after link).

DB2 is **not** in the bottle. After install:

```bash
foxschema drivers install db2
# or
docker pull 5nickels/foxschema:db2-latest
```

## Tap repository

Create (once) a GitHub repo `tedious-code/homebrew-foxschema` with:

```
Formula/foxschema.rb
```

Copy from this monorepo:

[`packaging/homebrew/foxschema.rb`](./foxschema.rb)

## Updating for a new release

1. Publish `foxschema@VERSION` to npm (`.github/workflows/npm-publish.yml` on tag).
2. Refresh the formula checksum:

```bash
./packaging/homebrew/update-formula.sh 0.1.66
```

3. Copy into the tap and push:

```bash
cp packaging/homebrew/foxschema.rb ../homebrew-foxschema/Formula/foxschema.rb
cd ../homebrew-foxschema
git commit -am "foxschema 0.1.66"
git push
```

## Notes

- Formula installs with `npm install -g --prefix=…` under `libexec`, then
  symlinks `foxschema` / `fox` into Homebrew’s `bin`.
- Desktop Tauri `.dmg` / winget MSI remain separate legacy channels.
