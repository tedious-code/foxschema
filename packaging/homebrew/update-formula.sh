#!/usr/bin/env bash
# Refresh Formula/foxschema.rb url + sha256 from the npm registry.
# Usage: ./packaging/homebrew/update-formula.sh [version]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="${1:-$(node -p "require('$ROOT/apps/cli/package.json').version")}"
TGZ_URL="https://registry.npmjs.org/foxschema/-/foxschema-${VERSION}.tgz"
TMP="$(mktemp)"
echo "Fetching ${TGZ_URL}"
curl -fsSL "$TGZ_URL" -o "$TMP"
SHA="$(shasum -a 256 "$TMP" | awk '{print $1}')"
rm -f "$TMP"
FORMULA="$ROOT/Formula/foxschema.rb"
# portable in-place replace for macOS/Linux
perl -i -pe "s|url \".*\"|url \"${TGZ_URL}\"|" "$FORMULA"
perl -i -pe "s|sha256 \".*\"|sha256 \"${SHA}\"|" "$FORMULA"
echo "Updated $FORMULA"
echo "  version $VERSION"
echo "  sha256  $SHA"
echo
echo "Commit and push on main (same repo — no separate tap):"
echo "  git add Formula/foxschema.rb && git commit -m \"brew: foxschema ${VERSION}\" && git push"
