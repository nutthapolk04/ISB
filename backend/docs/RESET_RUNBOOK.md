# Database Reset Runbook

Two reset modes are supported, both via `seed.py` CLI:

| Mode | Use case | Command |
|---|---|---|
| `--reset` | Dev/staging: wipe + reseed full demo data | `python seed.py --reset` |
| `--handoff` | Production: wipe + keep ONE admin only | `python seed.py --handoff --yes` |

`start.sh` reads the `SEED_MODE` env var to decide what to do at boot:

- `SEED_MODE=skip` — don't run seed (use after handoff)
- `SEED_MODE=incremental` — default; idempotent upsert
- `SEED_MODE=reset` — wipe and reseed (DEV ONLY)
- `SEED_MODE=handoff` — wipe, leave admin only

---

## Dev test reset (full reseed)

**Local:**

```bash
cd backend
python seed.py --reset
```

**Fly staging (if you want demo data on the live server):**

```bash
fly ssh console -a isb-coop-pos
cd /app/backend && python seed.py --reset
```

After this you have demo accounts (admin, manager_*, cashier_*, PowerSchool staff/parents/students), 6 shops, ~100 products, 3 departments.

---

## Production handoff (admin-only wipe)

**Step 1 — Backup first (always):**

```bash
fly postgres backup create -a isb-coop-pos-db
```

**Step 2 — SSH and run handoff:**

```bash
fly ssh console -a isb-coop-pos
cd /app/backend

# Customer-supplied password — change BEFORE running:
HANDOFF_ADMIN_PASSWORD='<strong-pw-here>' python seed.py --handoff --yes
```

Optional env vars:

- `HANDOFF_ADMIN_USERNAME` (default `admin`)
- `HANDOFF_ADMIN_EMAIL` (default `admin@isb-coop.local`)
- `HANDOFF_ADMIN_FULL_NAME` (default `System Administrator`)

**Step 3 — Lock down boot seed so it never repopulates demo data:**

```bash
fly secrets set SEED_MODE=skip -a isb-coop-pos
```

**Step 4 — Verify:**

```bash
# Login should return 200 + access_token
curl -X POST https://isb-coop-pos.fly.dev/api/v1/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"<strong-pw-here>"}'

# DB should have 1 user + 0 of everything else
fly postgres connect -a isb-coop-pos-db
\c isb_coop_pos
SELECT 'users' AS t, count(*) FROM users
UNION ALL SELECT 'shops', count(*) FROM shops
UNION ALL SELECT 'shop_products', count(*) FROM shop_products
UNION ALL SELECT 'customers', count(*) FROM customers
UNION ALL SELECT 'departments', count(*) FROM departments
UNION ALL SELECT 'wallets', count(*) FROM wallets
UNION ALL SELECT 'receipts', count(*) FROM receipts
UNION ALL SELECT 'parent_child_links', count(*) FROM parent_child_links
UNION ALL SELECT 'sync_logs', count(*) FROM sync_logs;
```

Expect `users=1`, everything else `0`.

**Step 5 — Restart sanity check:**

```bash
fly machine restart -a isb-coop-pos
fly logs -a isb-coop-pos | grep SEED_MODE
# should print: SEED_MODE=skip — not running seed.py
```

---

## Rollback handoff (restore demo data)

If the customer wants demo data back:

```bash
fly secrets set SEED_MODE=incremental -a isb-coop-pos
fly ssh console -a isb-coop-pos
cd /app/backend && python seed.py --reset
```

---

## Safety notes

- `--handoff` refuses to run without `--yes` or `HANDOFF_CONFIRM=1`. Mistyping the
  command never wipes the DB.
- Always `fly postgres backup create` before any destructive op on prod.
- `SEED_MODE=skip` is the only safe boot mode after handoff. Forgetting this
  means the next deploy will see no data and the boot script will (incrementally)
  re-seed nothing — but if `SEED_MODE=incremental` is left, the seed will run
  the demo upserts, which is fine for an empty DB but wrong for a customer
  using the system.
