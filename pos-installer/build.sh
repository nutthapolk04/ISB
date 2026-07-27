#!/usr/bin/env bash
# ISB POS Setup — build script (run on macOS)
#
# Assembles pos-installer/payload/ from local sources + downloads, then
# runs makensis against installer.nsi to produce:
#   pos-installer/dist/ISB-POS-Setup-1.0.0.exe
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PAYWIRE_SRC="/Users/kawinwatsayangbarp/Downloads/Paywire_1.0.0/paywire.exe"
DRIVER_ZIP="/Users/kawinwatsayangbarp/Downloads/whql_Driver2020.zip"
MAKENSIS="${MAKENSIS:-/opt/homebrew/bin/makensis}"

CACHE_DIR="$SCRIPT_DIR/cache"
PAYLOAD_DIR="$SCRIPT_DIR/payload"
DIST_DIR="$SCRIPT_DIR/dist"

mkdir -p "$CACHE_DIR" "$DIST_DIR"

echo "== ISB POS Setup — build =="
echo "Script dir: $SCRIPT_DIR"

# ---------------------------------------------------------------------------
# 0. Preconditions
# ---------------------------------------------------------------------------
if [ ! -f "$PAYWIRE_SRC" ]; then
  echo "ERROR: paywire.exe not found at $PAYWIRE_SRC" >&2
  exit 1
fi
if [ ! -f "$DRIVER_ZIP" ]; then
  echo "ERROR: driver zip not found at $DRIVER_ZIP" >&2
  exit 1
fi
if [ ! -x "$MAKENSIS" ]; then
  echo "ERROR: makensis not found/executable at $MAKENSIS" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. Fresh payload/
# ---------------------------------------------------------------------------
echo ""
echo "-- Resetting payload/ --"
rm -rf "$PAYLOAD_DIR"
mkdir -p "$PAYLOAD_DIR/paywire" "$PAYLOAD_DIR/driver"

# ---------------------------------------------------------------------------
# 2. Paywire EDC bridge (exe only, no sdk-js)
# ---------------------------------------------------------------------------
echo ""
echo "-- payload/paywire/paywire.exe --"
cp "$PAYWIRE_SRC" "$PAYLOAD_DIR/paywire/paywire.exe"
echo "   copied ($(du -h "$PAYLOAD_DIR/paywire/paywire.exe" | cut -f1))"

# ---------------------------------------------------------------------------
# 3. EDC USB driver (whql_Driver2020)
# ---------------------------------------------------------------------------
echo ""
echo "-- payload/driver/ (whql_Driver2020) --"
DRIVER_TMP="$CACHE_DIR/driver-extract"
rm -rf "$DRIVER_TMP"
mkdir -p "$DRIVER_TMP"
unzip -q "$DRIVER_ZIP" -d "$DRIVER_TMP"

# The zip contains a single top-level folder (whql_Driver2020/); copy its
# contents (not the wrapper folder itself) into payload/driver/.
INNER_DIR=$(find "$DRIVER_TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -z "$INNER_DIR" ]; then
  echo "ERROR: could not find inner folder inside whql_Driver2020.zip" >&2
  exit 1
fi
cp -R "$INNER_DIR"/. "$PAYLOAD_DIR/driver/"
rm -rf "$DRIVER_TMP"
echo "   extracted ($(du -sh "$PAYLOAD_DIR/driver" | cut -f1))"

# ---------------------------------------------------------------------------
# 4. Run makensis
# ---------------------------------------------------------------------------
echo ""
echo "-- Running makensis --"
"$MAKENSIS" -V2 installer.nsi

OUT_EXE="$DIST_DIR/ISB-POS-Setup-1.0.0.exe"
if [ ! -f "$OUT_EXE" ]; then
  echo "ERROR: expected output not found at $OUT_EXE" >&2
  exit 1
fi

echo ""
echo "== Build complete =="
echo "Output: $OUT_EXE"
echo "Size:   $(du -h "$OUT_EXE" | cut -f1)"
