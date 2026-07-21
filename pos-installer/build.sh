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
RFID_BRIDGE_SRC="$SCRIPT_DIR/../rfid-bridge"
MAKENSIS="${MAKENSIS:-/opt/homebrew/bin/makensis}"

CACHE_DIR="$SCRIPT_DIR/cache"
PAYLOAD_DIR="$SCRIPT_DIR/payload"
DIST_DIR="$SCRIPT_DIR/dist"

NODE_MAJOR="26"
NSSM_VERSION="2.24"
NSSM_URL="https://nssm.cc/release/nssm-${NSSM_VERSION}.zip"
NSSM_ZIP="$CACHE_DIR/nssm-${NSSM_VERSION}.zip"

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
if [ ! -d "$RFID_BRIDGE_SRC" ]; then
  echo "ERROR: rfid-bridge source dir not found at $RFID_BRIDGE_SRC" >&2
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
mkdir -p "$PAYLOAD_DIR/paywire" "$PAYLOAD_DIR/driver" "$PAYLOAD_DIR/rfid-bridge" "$PAYLOAD_DIR/node"

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
# 4. rfid-bridge payload (selected files only)
# ---------------------------------------------------------------------------
echo ""
echo "-- payload/rfid-bridge/ (selected files) --"
for f in rfid-server.js package.json package-lock.json test-reader.js README.md; do
  if [ -f "$RFID_BRIDGE_SRC/$f" ]; then
    cp "$RFID_BRIDGE_SRC/$f" "$PAYLOAD_DIR/rfid-bridge/$f"
    echo "   + $f"
  else
    echo "   ! WARNING: $f not found in $RFID_BRIDGE_SRC, skipping"
  fi
done

# ---------------------------------------------------------------------------
# 5. Node.js portable (win-x64) — cached download
# ---------------------------------------------------------------------------
echo ""
echo "-- payload/node/ (Node.js portable win-x64) --"
NODE_INDEX_URL="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/"
NODE_FILENAME=$(curl -sL "$NODE_INDEX_URL" | grep -oE "node-v${NODE_MAJOR}\.[0-9]+\.[0-9]+-win-x64\.zip" | sort -u | tail -1)
if [ -z "$NODE_FILENAME" ]; then
  echo "ERROR: could not find node-v${NODE_MAJOR}.*-win-x64.zip in $NODE_INDEX_URL listing" >&2
  exit 1
fi
NODE_URL="${NODE_INDEX_URL}${NODE_FILENAME}"
NODE_ZIP="$CACHE_DIR/$NODE_FILENAME"
echo "   resolved: $NODE_URL"

if [ -f "$NODE_ZIP" ]; then
  echo "   using cached $NODE_ZIP"
else
  echo "   downloading..."
  curl -fL --progress-bar -o "$NODE_ZIP.part" "$NODE_URL"
  mv "$NODE_ZIP.part" "$NODE_ZIP"
fi

NODE_TMP="$CACHE_DIR/node-extract"
rm -rf "$NODE_TMP"
mkdir -p "$NODE_TMP"
unzip -q "$NODE_ZIP" -d "$NODE_TMP"
NODE_INNER_DIR=$(find "$NODE_TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
if [ -z "$NODE_INNER_DIR" ] || [ ! -f "$NODE_INNER_DIR/node.exe" ]; then
  echo "ERROR: node.exe not found inside extracted $NODE_ZIP" >&2
  exit 1
fi
cp -R "$NODE_INNER_DIR"/. "$PAYLOAD_DIR/node/"
rm -rf "$NODE_TMP"
echo "   extracted ($(du -sh "$PAYLOAD_DIR/node" | cut -f1)), node.exe present: $([ -f "$PAYLOAD_DIR/node/node.exe" ] && echo yes || echo NO)"

# ---------------------------------------------------------------------------
# 6. nssm.exe (win64) — cached download
# ---------------------------------------------------------------------------
echo ""
echo "-- payload/nssm.exe --"
if [ -f "$NSSM_ZIP" ]; then
  echo "   using cached $NSSM_ZIP"
else
  echo "   downloading $NSSM_URL ..."
  curl -fL --progress-bar -o "$NSSM_ZIP.part" "$NSSM_URL"
  mv "$NSSM_ZIP.part" "$NSSM_ZIP"
fi

NSSM_TMP="$CACHE_DIR/nssm-extract"
rm -rf "$NSSM_TMP"
mkdir -p "$NSSM_TMP"
unzip -q "$NSSM_ZIP" -d "$NSSM_TMP"
NSSM_EXE_SRC=$(find "$NSSM_TMP" -type f -path "*win64/nssm.exe" | head -1)
if [ -z "$NSSM_EXE_SRC" ]; then
  echo "ERROR: win64/nssm.exe not found inside $NSSM_ZIP" >&2
  exit 1
fi
cp "$NSSM_EXE_SRC" "$PAYLOAD_DIR/nssm.exe"
rm -rf "$NSSM_TMP"
echo "   copied ($(du -h "$PAYLOAD_DIR/nssm.exe" | cut -f1))"

# ---------------------------------------------------------------------------
# 7. OFFLINE mode: prebuilt node_modules — REQUIRED by default.
#
# Without this, install-rfid-service.ps1 runs `npm install` on the POS
# machine itself, which needs internet AND Visual Studio Build Tools (C++
# workload, for compiling the native @pokusew/pcsclite module) — neither of
# which a freshly provisioned POS terminal has. A build shipped without the
# bundled node_modules is not a "run the .exe and you're done" installer:
# the RFID service silently fails to register if npm install fails, with
# no manual follow-up step for anyone to notice or fix on-site.
#
# Set ALLOW_ONLINE_BUILD=1 to explicitly opt out for a local/test build
# where you genuinely want the POS machine to run npm install itself.
# ---------------------------------------------------------------------------
echo ""
PREBUILT_ZIP="$SCRIPT_DIR/prebuilt-node_modules.zip"
if [ ! -f "$PREBUILT_ZIP" ] && [ "${ALLOW_ONLINE_BUILD:-}" != "1" ]; then
  echo "ERROR: pos-installer/prebuilt-node_modules.zip not found." >&2
  echo "" >&2
  echo "  A build without it requires npm install (internet + Visual Studio" >&2
  echo "  Build Tools) to succeed unattended on the POS machine — that is not" >&2
  echo "  a true 'install and it just works' installer. See README.md's" >&2
  echo "  OFFLINE mode section for how to generate this zip from a POS" >&2
  echo "  machine where rfid-bridge already works." >&2
  echo "" >&2
  echo "  To build anyway (online mode, POS runs npm install itself):" >&2
  echo "    ALLOW_ONLINE_BUILD=1 ./build.sh" >&2
  exit 1
fi

if [ -f "$PREBUILT_ZIP" ]; then
  echo "== OFFLINE mode: bundling prebuilt node_modules into payload/rfid-bridge/node_modules =="
  unzip -q "$PREBUILT_ZIP" -d "$PAYLOAD_DIR/rfid-bridge/" -x "__MACOSX/*"
  if [ ! -d "$PAYLOAD_DIR/rfid-bridge/node_modules" ]; then
    echo "ERROR: prebuilt-node_modules.zip did not produce payload/rfid-bridge/node_modules — check the zip's internal layout (it should contain a top-level node_modules/ folder)" >&2
    exit 1
  fi

  # ── Validate the native module is a WINDOWS binary ────────────────────
  # A common mistake is zipping the Mac's node_modules (Mach-O arm64) —
  # shipping that would silently break the bridge on the POS AND skip
  # npm install. pcsclite.node must be a Windows x64 DLL (PE32+).
  guard_fail() {
    echo "" >&2
    echo "❌ OFFLINE payload validation FAILED: $1" >&2
    echo "" >&2
    echo "   prebuilt-node_modules.zip ต้องมาจากเครื่อง POS (Windows) ที่ rfid-bridge" >&2
    echo "   ใช้งานได้จริงแล้วเท่านั้น — zip จากเครื่อง Mac/Linux ใช้ไม่ได้" >&2
    echo "   The zip must come from a Windows POS machine where the bridge" >&2
    echo "   already works — a Mac/Linux node_modules will not run on Windows." >&2
    echo "" >&2
    echo "   สร้าง zip ที่ถูกต้องบนเครื่อง POS ด้วย PowerShell:" >&2
    echo "   Create a valid zip on the POS with PowerShell:" >&2
    echo "     Compress-Archive -Path C:\\Users\\isb\\Desktop\\rfid-bridge\\node_modules -DestinationPath \$env:USERPROFILE\\Desktop\\prebuilt-node_modules.zip" >&2
    echo "" >&2
    # Clean up so a later run can't accidentally build ONLINE with a stale
    # (and wrong-platform) node_modules dir left in the payload.
    rm -rf "$PAYLOAD_DIR/rfid-bridge/node_modules"
    echo "   (cleaned up payload/rfid-bridge/node_modules)" >&2
    exit 1
  }

  PCSCLITE_NODE="$PAYLOAD_DIR/rfid-bridge/node_modules/@pokusew/pcsclite/build/Release/pcsclite.node"
  if [ ! -f "$PCSCLITE_NODE" ]; then
    guard_fail "node_modules/@pokusew/pcsclite/build/Release/pcsclite.node not found in the zip"
  fi

  FILE_TYPE=$(file -b "$PCSCLITE_NODE")
  if echo "$FILE_TYPE" | grep -q "PE32+"; then
    echo "✅ prebuilt node_modules validated: Windows PE32+ (OFFLINE mode)"
    echo "   pcsclite.node: $FILE_TYPE"
  else
    guard_fail "pcsclite.node is not a Windows PE32+ binary — detected: $FILE_TYPE"
  fi

  echo "   node_modules bundled ($(du -sh "$PAYLOAD_DIR/rfid-bridge/node_modules" | cut -f1))"
else
  echo "== ONLINE mode (ALLOW_ONLINE_BUILD=1): no prebuilt-node_modules.zip — installer.nsi will run npm install on the POS machine =="
fi

# ---------------------------------------------------------------------------
# 8. Run makensis
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
