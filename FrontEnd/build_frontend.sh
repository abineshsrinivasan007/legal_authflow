#!/usr/bin/env bash
# Exit on error
set -e

echo "=== 🔍 Starting Frontend Build Process ==="
echo "Current Working Directory: $(pwd)"

if [ -d "FrontEnd" ]; then
  echo "Entering FrontEnd directory..."
  cd FrontEnd
else
  echo "Already in FrontEnd directory or FrontEnd folder not found. Proceeding in current directory."
fi

echo "Current Directory: $(pwd)"
echo "Listing directory contents:"
ls -la

echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"

echo "Running npm install..."
npm install --legacy-peer-deps

echo "Running npm run build..."
npm run build

echo "=== ✅ Frontend Build Finished Successfully ==="
