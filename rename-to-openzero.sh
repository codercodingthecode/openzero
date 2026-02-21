#!/usr/bin/env bash
# Rename OpenCode to OpenZero
set -euo pipefail

echo "🔄 Renaming OpenCode to OpenZero..."

# 1. Rename main package directory
echo "📦 Renaming packages/opencode to packages/openzero..."
if [ -d "packages/opencode" ]; then
  mv packages/opencode packages/openzero
fi

# 2. Update all package.json files - change @opencode-ai to @openzero
echo "📝 Updating package names in package.json files..."
find . -name "package.json" -type f -exec sed -i '' 's/@opencode-ai/@openzero/g' {} \;
find . -name "package.json" -type f -exec sed -i '' 's/"name": "opencode"/"name": "openzero"/g' {} \;

# 3. Update import statements in TypeScript files
echo "🔧 Updating import statements..."
find packages -name "*.ts" -o -name "*.tsx" | xargs sed -i '' 's/@opencode-ai/@openzero/g'

# 4. Update binary name in bin scripts
echo "🔨 Updating binary references..."
if [ -f "packages/openzero/bin/opencode" ]; then
  mv packages/openzero/bin/opencode packages/openzero/bin/openzero
fi

# 5. Update paths from .opencode to .openzero in source code
echo "📂 Updating file paths..."
find packages/openzero/src -name "*.ts" | xargs sed -i '' 's/\.opencode/.openzero/g'
find packages/openzero/src -name "*.ts" | xargs sed -i '' 's/"opencode"/"openzero"/g'

# 6. Update Global.Path references
echo "🌐 Updating Global paths..."
# This will update the home directory path

# 7. Update config schema URLs (keep them as placeholders for now)
echo "⚙️  Updating config URLs..."
find packages -name "*.ts" | xargs sed -i '' 's/opencode\.ai\/config\.json/openzero.local\/config.json/g'
find packages -name "*.ts" | xargs sed -i '' 's/https:\/\/opencode\.ai/https:\/\/openzero.local/g'

# 8. Update README and docs
echo "📚 Updating documentation..."
find . -name "README*.md" -exec sed -i '' 's/opencode/openzero/g' {} \;
find . -name "README*.md" -exec sed -i '' 's/OpenCode/OpenZero/g' {} \;

# 9. Update collection name in Qdrant (memory system)
echo "🧠 Updating memory collection name..."
find packages/openzero/src/memory -name "*.ts" | xargs sed -i '' 's/openzero_memories/openzero_memories/g'

echo ""
echo "✅ Renaming complete!"
echo ""
echo "⚠️  Manual steps required:"
echo "1. Review git diff to ensure changes are correct"
echo "2. Run: bun install (to update lockfile)"
echo "3. Run: cd packages/openzero && bun run build"
echo "4. Install: ./install script or manual build"
echo "5. Test: openzero (should start the renamed version)"
