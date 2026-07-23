# Publishing Fox Schema to Homebrew

The CLI (`foxschema`) is installed via a Homebrew formula that wraps the
published npm package. That gives correct Arm64 and x86_64 native driver
binaries per machine.

## Install (users)

```bash
brew tap tedious-code/foxschema
brew install foxschema
foxschema
```

Requires Homebrew’s `node@22` (or newer Node 22+ on PATH after link).

One formula — same npm package as `npm i -g foxschema`. Docker
`5nickels/foxschema:latest` is the self-host image (linux/amd64, includes Db2).

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
