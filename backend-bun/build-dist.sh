#!/usr/bin/env bash
# Build backend-bun dist locally (run on your dev machine before SFTP to prod/uat).
#
# Usage (from backend-bun/ or repo root):
#   ./backend-bun/build-dist.sh
#
# Then SFTP backend-bun/dist/ to the server and run ./deploy.sh <prod|uat> there.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Installing workspace dependencies"
bun install --frozen-lockfile

echo "==> Building backend-bun bundle"
bun --cwd backend-bun run build

if [ ! -f backend-bun/dist/server.js ]; then
  echo "ERROR: backend-bun/dist/server.js not found after build"
  exit 1
fi

echo ""
echo "==> Build OK"
echo "    SFTP this folder to the server:"
echo "      backend-bun/dist/"
echo "    Then on the server (in backend-bun/):"
echo "      ./deploy.sh prod   # or uat"
