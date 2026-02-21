#!/usr/bin/env bash
# Install openzero binary for development
set -euo pipefail

cd "$(dirname "$0")/.."

echo "🔨 Building openzero binary..."
cd packages/openzero
bun run script/build.ts --single --skip-install

echo "📦 Installing dependencies..."
bun install

echo "🔗 Installing to ~/.local/bin..."
mkdir -p ~/.local/bin
cp dist/openzero-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')/bin/openzero ~/.local/bin/openzero
chmod +x ~/.local/bin/openzero

echo "✅ Done! openzero version:"
openzero --version
