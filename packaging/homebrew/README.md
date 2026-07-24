# Homebrew (same repo)

The formula lives in this monorepo at [`Formula/foxschema.rb`](../../Formula/foxschema.rb).
There is **no** separate `homebrew-foxschema` tap.

## Install (users)

```bash
brew tap tedious-code/foxschema https://github.com/tedious-code/foxschema
brew trust tedious-code/foxschema   # required once on Homebrew 6+
brew install foxschema
foxschema
foxschema shortcut   # optional Fox icon on Desktop
```

Requires Homebrew’s `node@22` (or newer Node 22+ on PATH after link).

Same npm package as `npm i -g foxschema`. Docker image:
`5nickels/foxschema:latest` (linux/amd64, includes Db2).

## Updating after an npm release

1. Publish `foxschema@VERSION` to npm.
2. Refresh the formula checksum:

```bash
./packaging/homebrew/update-formula.sh 0.1.67
```

3. Commit `Formula/foxschema.rb` on `main` and push.

Users who already tapped get updates with `brew update && brew upgrade foxschema`.
