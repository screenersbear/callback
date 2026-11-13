#!/bin/sh
# Installs the App Safety Kit's test tools (node_modules) OUTSIDE OneDrive and
# links them into this folder, so OneDrive doesn't upload hundreds of MB.
# Run this instead of `npm install` here: npm replaces the link with a real
# folder. After changing devDependencies, run `npm install --package-lock-only`
# here first so package-lock.json is current, then this.
set -e
cd "$(dirname "$0")/.."
PATH="$HOME/.local/node/bin:$PATH"
DEST="$HOME/.local/share/app-safety/callback"
mkdir -p "$DEST"
cp package.json package-lock.json "$DEST/"
(cd "$DEST" && npm ci --no-audit --no-fund --loglevel=error)
if [ -e node_modules ] && [ ! -L node_modules ]; then rm -rf node_modules; fi
ln -sfn "$DEST/node_modules" node_modules
npx playwright install chromium webkit
echo "Test tools ready: node_modules -> $DEST/node_modules"
