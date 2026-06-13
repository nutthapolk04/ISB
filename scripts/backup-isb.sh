#!/usr/bin/env bash
# One-time production backup before Bun/Elysia migration.
# Usage:
#   DATABASE_URL='postgresql://user:pass@host:port/db' ./scripts/backup-isb.sh
#
# Where to get DATABASE_URL:
#   Railway dashboard -> Postgres service -> Variables -> DATABASE_PUBLIC_URL
#   (use the PUBLIC URL, not the internal railway.internal one)
#
# Override pg_dump path:
#   PG_DUMP=/path/to/pg_dump DATABASE_URL='...' ./scripts/backup-isb.sh

set -euo pipefail

PG_DUMP="${PG_DUMP:-/opt/homebrew/opt/postgresql@18/bin/pg_dump}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL not set" >&2
  echo "Example: DATABASE_URL='postgresql://...' $0" >&2
  exit 1
fi

if [[ ! -x "${PG_DUMP}" ]]; then
  echo "ERROR: pg_dump not found at ${PG_DUMP}" >&2
  echo "Install with: brew install postgresql@18" >&2
  exit 1
fi

STAMP=$(date +%Y-%m-%d_%H%M%S)
OUT_DIR="${HOME}/backups/isb/${STAMP}"
mkdir -p "${OUT_DIR}"

echo "==> Backup destination: ${OUT_DIR}"
echo "==> Using: ${PG_DUMP}"
"${PG_DUMP}" --version
echo

# 1) Full custom-format dump (best for restore: pg_restore)
echo "==> [1/3] pg_dump (custom format, compressed)..."
"${PG_DUMP}" "${DATABASE_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --verbose \
  --file="${OUT_DIR}/isb-db.dump" 2> "${OUT_DIR}/pg_dump.log"

# 2) Plain SQL dump (human readable, for inspection)
echo "==> [2/3] pg_dump (plain SQL, gzipped)..."
"${PG_DUMP}" "${DATABASE_URL}" \
  --no-owner \
  --no-privileges \
  | gzip > "${OUT_DIR}/isb-db.sql.gz"

# 3) Schema-only dump (quick to inspect structure)
echo "==> [3/3] pg_dump (schema only)..."
"${PG_DUMP}" "${DATABASE_URL}" \
  --schema-only \
  --no-owner \
  --no-privileges \
  > "${OUT_DIR}/isb-schema.sql"

# Record git baseline
GIT_HEAD=$(git -C "$(dirname "$0")/.." rev-parse HEAD)
GIT_BRANCH=$(git -C "$(dirname "$0")/.." rev-parse --abbrev-ref HEAD)
cat > "${OUT_DIR}/MANIFEST.txt" <<EOF
ISB Production Backup
=====================
Timestamp:    ${STAMP}
Git branch:   ${GIT_BRANCH}
Git commit:   ${GIT_HEAD}
Postgres ver: $("${PG_DUMP}" --version)
Host:         $(echo "${DATABASE_URL}" | sed -E 's|.*@([^:/]+).*|\1|')

Files:
  isb-db.dump      - pg_restore format (recommended for restore)
  isb-db.sql.gz    - plain SQL dump (gzipped)
  isb-schema.sql   - schema only, no data
  pg_dump.log      - pg_dump verbose output

Restore:
  pg_restore --clean --if-exists --no-owner -d <target_db> isb-db.dump
EOF

echo
echo "==> Done. Files:"
ls -lh "${OUT_DIR}"
echo
echo "==> Total size: $(du -sh "${OUT_DIR}" | cut -f1)"
