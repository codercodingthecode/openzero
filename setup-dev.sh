#!/usr/bin/env bash
# OpenZero Development Setup
# One-time setup: Build, link CLI, start web server, run migrations
set -euo pipefail

cd "$(dirname "$0")"

echo "🚀 OpenZero Development Setup"
echo ""

# Detect platform first
echo "🔍 Detecting platform..."
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

echo "   Platform: $PLATFORM-$ARCH"

# Remove platform package from dependencies if it exists (circular dependency issue)
if grep -q "openzero-darwin-arm64" packages/openzero/package.json || grep -q "openzero-linux" packages/openzero/package.json || grep -q "openzero-windows" packages/openzero/package.json; then
  echo "🔧 Removing platform package dependencies to avoid circular dependency..."
  # Use perl to remove platform package lines from package.json
  perl -i -pe 's/^\s*"openzero-(darwin|linux|windows)[^"]*":\s*"[^"]*",?\n//' packages/openzero/package.json
fi

# Install dependencies
echo "📦 Installing dependencies..."
bun install

# Database migrations will auto-run on first openzero start
echo "🗄️  Database migrations will auto-run on first use"

# Download Qdrant for memory system
echo "💾 Downloading Qdrant vector database..."
QDRANT_VERSION="v1.17.0"
QDRANT_BIN_DIR="$HOME/.local/share/openzero/bin"
mkdir -p "$QDRANT_BIN_DIR"

# Map platform/arch to Qdrant naming
if [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "arm64" ]; then
  QDRANT_ARCHIVE="qdrant-aarch64-apple-darwin.tar.gz"
elif [ "$PLATFORM" = "darwin" ] && [ "$ARCH" = "x64" ]; then
  QDRANT_ARCHIVE="qdrant-x86_64-apple-darwin.tar.gz"
elif [ "$PLATFORM" = "linux" ] && [ "$ARCH" = "arm64" ]; then
  QDRANT_ARCHIVE="qdrant-aarch64-unknown-linux-musl.tar.gz"
elif [ "$PLATFORM" = "linux" ] && [ "$ARCH" = "x64" ]; then
  QDRANT_ARCHIVE="qdrant-x86_64-unknown-linux-musl.tar.gz"
else
  echo "⚠️  Unsupported platform for Qdrant: $PLATFORM-$ARCH"
  QDRANT_ARCHIVE=""
fi

if [ -n "$QDRANT_ARCHIVE" ]; then
  # Check if binary exists and is valid (not just a text file saying "Not Found")
  NEED_DOWNLOAD=true
  if [ -f "$QDRANT_BIN_DIR/qdrant" ]; then
    if file "$QDRANT_BIN_DIR/qdrant" | grep -q "executable"; then
      echo "   ✓ Qdrant binary already exists"
      NEED_DOWNLOAD=false
    else
      echo "   ⚠️  Invalid Qdrant binary detected, re-downloading..."
      rm -f "$QDRANT_BIN_DIR/qdrant"
    fi
  fi
  
  if [ "$NEED_DOWNLOAD" = true ]; then
    QDRANT_URL="https://github.com/qdrant/qdrant/releases/download/${QDRANT_VERSION}/${QDRANT_ARCHIVE}"
    echo "   Downloading from: $QDRANT_URL"
    curl -L -o "/tmp/${QDRANT_ARCHIVE}" "$QDRANT_URL"
    tar -xzf "/tmp/${QDRANT_ARCHIVE}" -C "$QDRANT_BIN_DIR"
    rm "/tmp/${QDRANT_ARCHIVE}"
    chmod +x "$QDRANT_BIN_DIR/qdrant"
    echo "   ✓ Qdrant binary installed to $QDRANT_BIN_DIR/qdrant"
  fi
fi

# Build and link CLI
echo "🔨 Building CLI..."
cd packages/openzero
bun run build

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

# Start Qdrant as persistent background service
echo "🔧 Starting Qdrant vector database..."
pkill -9 qdrant 2>/dev/null || true
QDRANT_BIN="$HOME/.local/share/openzero/bin/qdrant"
QDRANT_CONFIG="$HOME/.local/share/openzero/memory/qdrant-config.yaml"
QDRANT_DATA="$HOME/.local/share/openzero/memory/qdrant-data"

if [ -f "$QDRANT_BIN" ]; then
  mkdir -p "$HOME/.local/share/openzero/memory"
  mkdir -p "$QDRANT_DATA"
  
  # Create Qdrant config
  cat > "$QDRANT_CONFIG" <<EOF
storage:
  storage_path: $QDRANT_DATA
service:
  grpc_port: 6334
  http_port: 6333
log_level: WARN
EOF
  
  nohup "$QDRANT_BIN" --config-path "$QDRANT_CONFIG" > /tmp/qdrant.log 2>&1 &
  echo $! > /tmp/qdrant.pid
  sleep 2
  echo "   ✓ Qdrant started (PID: $(cat /tmp/qdrant.pid))"
else
  echo "   ⚠️  Qdrant binary not found, memory system will not work"
fi

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
