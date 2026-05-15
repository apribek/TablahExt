#!/bin/bash
set -e

# Verify production config is selected
if grep -q 'const ENV = "local"' config.js; then
    echo "ERROR: config.js has ENV=\"local\" — switch to \"production\" before building."
    exit 1
fi

VERSION=$(grep '"version"' manifest.json | sed 's/.*: "\(.*\)".*/\1/')
OUTPUT="tablah-ext-v${VERSION}.zip"

FRONTEND_PUBLIC="../cv-aution/frontend/public/tablah-extension.zip"

rm -f "$OUTPUT"

zip -r "$OUTPUT" \
    manifest.json \
    config.js \
    auth-sync.js \
    content.js \
    service-worker.js \
    popup.html \
    popup.js \
    sidepanel.html \
    sidepanel.js \
    portals.js \
    search-crawler.js \
    detail-crawler.js \
    icons/

cp "$OUTPUT" "$FRONTEND_PUBLIC"
echo "Built: $OUTPUT → $FRONTEND_PUBLIC"
