# Backup & Restore — Postgres

Railway Pro plan is required for built-in Postgres backups (PITR + volume
snapshots). On lower tiers we keep backups manually with `pg_dump` from a
local workstation that holds the `DATABASE_PUBLIC_URL`.

## Where backups live

- **Local path:** `~/ISB/backups/` (gitignored)
- **Off-machine:** none by default. Copy outside the laptop manually
  (iCloud Drive, Google Drive, external disk) before any destructive ops
  — losing the laptop loses every snapshot.

## Backup

The server runs Postgres 18; the local client must match.

```bash
brew install postgresql@18   # one-time

# Grab the URL from Railway then dump both formats. Binary is for fast
# pg_restore; plain SQL gzip is for inspection / partial recovery.
cd ~/ISB
PUBLIC_URL=$(railway variables --service Postgres --json \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])")

STAMP=$(date +%Y%m%d_%H%M%S)
PG=/opt/homebrew/opt/postgresql@18/bin

$PG/pg_dump --no-owner --no-acl -F c \
  -f ~/ISB/backups/isb_prod_$STAMP.dump "$PUBLIC_URL"

$PG/pg_dump --no-owner --no-acl "$PUBLIC_URL" \
  | gzip > ~/ISB/backups/isb_prod_$STAMP.sql.gz
```

Quick sanity check: `pg_restore --list backup.dump` should print one
`TABLE DATA` row per non-empty table.

## Restore (full DB)

⚠️ This wipes the live DB and replaces it. The frontend may briefly see
500s while restore runs.

```bash
PG=/opt/homebrew/opt/postgresql@18/bin
PUBLIC_URL=$(railway variables --service Postgres --json \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['DATABASE_PUBLIC_URL'])")

$PG/pg_restore --clean --no-owner --no-acl \
  -d "$PUBLIC_URL" \
  ~/ISB/backups/isb_prod_YYYYMMDD_HHMMSS.dump
```

After restore, smoke-test:
1. `POST /api/v1/auth/login` with a known admin → 200 + JWT
2. `GET /api/v1/admin/settings/school` → returns school_name etc.
3. Spot-check a wallet balance against what you knew pre-restore.

## Test-reset (wipe everything except admins + settings)

The reset SQL in `~/ISB/backups/reset_test_data.sql` deletes shops,
products, customers, wallets, receipts, departments, UoM, spending
groups, and all non-admin users. It keeps `system_settings`, `roles`,
`customer_types`, and the two admin users (id=1, 53).

The committed `reset_test_data.sql` ends with `ROLLBACK` — use it as a
dry-run first. To execute for real, copy it and swap the last line to
`COMMIT`. Always pg_dump first.

```bash
# Dry-run (rollback at the end — no rows actually deleted)
$PG/psql "$PUBLIC_URL" -f ~/ISB/backups/reset_test_data.sql

# Real run — ⚠️ keep a fresh pg_dump from this same session
sed 's/^ROLLBACK;$/COMMIT;/' ~/ISB/backups/reset_test_data.sql \
  > /tmp/reset_COMMIT.sql
$PG/psql "$PUBLIC_URL" -v ON_ERROR_STOP=1 -f /tmp/reset_COMMIT.sql
```

The script asserts invariants after the deletes (2 admins survive,
10 `system_settings` rows survive, `shops`/`customers`/`wallets` are
empty). If any assertion fails the whole transaction rolls back.
