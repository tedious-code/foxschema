#!/usr/bin/env bash
# Cloud Agent install: idempotent repository bootstrap for FoxSchema.
#
# FoxSchema develops on Node 24 (see AGENTS.md / CONTRIBUTING.md). The Cursor
# base image ships nvm with an older Node, so we install Node 24 via nvm and
# expose it as the default `node`/`npm`/`npx` by symlinking into
# /usr/local/cargo/bin, which is first on PATH in every shell. Then we install
# the npm workspace. This script is safe to run repeatedly.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR=24

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"

echo "▶ Installing Node ${NODE_MAJOR} via nvm …"
nvm install "$NODE_MAJOR"
nvm alias default "$NODE_MAJOR"
nvm use "$NODE_MAJOR"

NODE_BIN_DIR="$(dirname "$(nvm which "$NODE_MAJOR")")"
echo "  Node ${NODE_MAJOR} bin dir: $NODE_BIN_DIR"

# Expose Node 24 as the shell-wide default. /usr/local/cargo/bin is first on
# PATH, so symlinking here overrides the base image's older /exec-daemon/node
# without touching shell profiles. Fall back to ~/.local/bin if that dir is not
# writable in some future base image.
LINK_DIR=/usr/local/cargo/bin
if [ ! -w "$LINK_DIR" ]; then
  LINK_DIR="$HOME/.local/bin"
  mkdir -p "$LINK_DIR"
fi
for bin in node npm npx; do
  ln -sf "$NODE_BIN_DIR/$bin" "$LINK_DIR/$bin"
done
echo "  Linked node/npm/npx into $LINK_DIR"

hash -r 2>/dev/null || true
echo "  node: $(command -v node) -> $(node -v)"
echo "  npm:  $(command -v npm) -> v$(npm -v)"

echo "▶ Installing npm workspace …"
cd "$REPO"
npm install

echo "✓ install complete"
