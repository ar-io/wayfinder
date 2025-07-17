#!/bin/bash

# This script builds the extension and creates a versioned zip artifact.

set -e

# Get the extension version from package.json
VERSION=$(node -p "require('./package.json').version")

# Update manifest.json version to match package.json version
node -e "
const fs = require('fs');
const pkg = require('./package.json');
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
manifest.version = pkg.version.match(/^\d+\.\d+\.\d+/)[0];
fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));
"

# Clean previous build artifacts
rm -rf dist node_modules
rm -f wayfinder-extension-v*.zip

# Install latest dependencies
npm install

# run lint
npm run lint:fix -w @ar.io/wayfinder-extension

# Build the extension
echo "Building extension..."
npm run build -w @ar.io/wayfinder-extension

# Zip the contents of the dist directory into a versioned zip file
zip -r wayfinder-extension-v${VERSION}.zip dist

echo "Build and zip complete: wayfinder-extension-v${VERSION}.zip"

# output the version to github for use in the release
if [ -n "$GITHUB_OUTPUT" ]; then
  echo "VERSION=${VERSION}" >> $GITHUB_OUTPUT
fi
