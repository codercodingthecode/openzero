#!/usr/bin/env bash
# OpenZero Development Setup
# One-time setup: Build, link CLI, start web server, run migrations
set -euo pipefail

cd "$(dirname "$0")"

echo "🚀 OpenZero Development Setup"
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Database migrations will auto-run on first openzero start
echo "🗄️  Database migrations will auto-run on first use"

# Build and link CLI
echo "🔨 Building CLI..."
cd packages/openzero
bun run build

# Detect platform
PLATFORM=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

if [ "$PLATFORM" = "darwin" ]; then
  PLATFORM="darwin"
elif [ "$PLATFORM" = "linux" ]; then
  PLATFORM="linux"
fi

if [ "$ARCH" = "arm64" ] || [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
elif [ "$ARCH" = "x86_64" ]; then
  ARCH="x64"
fi

PACKAGE_NAME="openzero-${PLATFORM}-${ARCH}"
echo "📦 Installing platform package: $PACKAGE_NAME"
bun add ./dist/$PACKAGE_NAME

echo "🔗 Linking globally..."
bun link
cd ../..

# Kill any existing web servers
pkill -f "bun.*openzero.*serve" 2>/dev/null || true
pkill -f "bun.*app.*dev" 2>/dev/null || true

# Start backend server
echo "🌐 Starting backend server..."
cd packages/openzero
nohup bun run --conditions=browser ./src/index.ts serve --port 4096 > /tmp/openzero-backend.log 2>&1 &
echo $! > /tmp/openzero-backend.pid
cd ../..
sleep 2

# Start frontend
echo "🌐 Starting web frontend..."
cd packages/app
nohup bun dev -- --port 4444 > /tmp/openzero-frontend.log 2>&1 &
echo $! > /tmp/openzero-frontend.pid
cd ../..

echo ""
echo "✅ OpenZero is ready!"
echo ""
echo "📍 Available now:"
echo "  CLI:  openzero                    (from any directory)"
echo "  Web:  http://localhost:4444       (already running)"
echo ""
echo "📝 Logs:"
echo "  Backend:  tail -f /tmp/openzero-backend.log"
echo "  Frontend: tail -f /tmp/openzero-frontend.log"
echo ""
echo "🛑 To stop web servers:"
echo "  kill \$(cat /tmp/openzero-backend.pid)"
echo "  kill \$(cat /tmp/openzero-frontend.pid)"
echo ""
