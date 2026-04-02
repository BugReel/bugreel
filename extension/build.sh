#!/bin/bash
# Build BugReel extension for Chrome and Firefox
# Usage: cd extension && ./build.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"

echo "Building BugReel extension..."

# Clean previous builds
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/chrome" "$BUILD_DIR/firefox"

# Files shared between both browsers
COMMON_FILES=(
  background.js
  recorder.js
  recorder.html
  popup.html
  popup.js
  content-script-errors.js
  content-script-widget.js
  content-script-actions.js
  idb-helper.js
  chunked-uploader.js
  review.html
  review.js
  mic-permission.html
  mic-permission.js
  setup.html
  setup.js
  setup-firefox.html
  setup-firefox.js
)

# Copy common files to both builds
for f in "${COMMON_FILES[@]}"; do
  cp "$SCRIPT_DIR/$f" "$BUILD_DIR/chrome/$f"
  cp "$SCRIPT_DIR/$f" "$BUILD_DIR/firefox/$f"
done

# Copy icons
cp -r "$SCRIPT_DIR/icons" "$BUILD_DIR/chrome/icons"
cp -r "$SCRIPT_DIR/icons" "$BUILD_DIR/firefox/icons"

# Browser-specific manifests
cp "$SCRIPT_DIR/manifest.json" "$BUILD_DIR/chrome/manifest.json"
cp "$SCRIPT_DIR/manifest.firefox.json" "$BUILD_DIR/firefox/manifest.json"

# Package as ZIP
cd "$BUILD_DIR/chrome" && zip -r "$BUILD_DIR/bugreel-chrome.zip" . -x ".*" > /dev/null
cd "$BUILD_DIR/firefox" && zip -r "$BUILD_DIR/bugreel-firefox.zip" . -x ".*" > /dev/null

echo ""
echo "Build complete:"
echo "  Chrome:  build/bugreel-chrome.zip"
echo "  Firefox: build/bugreel-firefox.zip"
echo ""
echo "Install:"
echo "  Chrome:  chrome://extensions → Load unpacked → build/chrome/"
echo "  Firefox: about:debugging → Load Temporary Add-on → build/firefox/manifest.json"
