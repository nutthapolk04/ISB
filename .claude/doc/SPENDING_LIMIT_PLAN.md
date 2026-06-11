# Daily Spending Limit by Spending Group — Implementation Plan

> **Audience:** School administrator (non-technical) + ISB developer
> **Project:** Schooney Payment System (`/Users/nutthapolkumket/ISB/`)
> **Status:** Approved 2026-06-12 — ready for build
> **Author:** planner agent (design only, no code)

---

## Approved Decisions (the 4 open questions)

| # | Decision | Effect |
|---|---|---|
| 1 | **Block silently + show toast at next purchase attempt** | No mass-notification system needed |
| 2 | **Parent portal shows today only (v1)** | Lean UI; history is a follow-up PR |
| 3 | **Kiosk is NOT touched in this feature** | Removes all Vue work from scope |
| 4 | **`is_active=false` = skip enforcement (not block sales)** | UI label = "Enforce limit / Don't enforce" (TH: "บังคับใช้วงเงิน / ไม่บังคับ") |

---

## Executive Summary

1. Introduce a new concept — **Spending Group** — that bundles one or more shops under a single shared daily allowance.
2. Seed two groups: **Canteen (฿500/day)** and **Store (฿25,000/day)**. The store group covers coop, bookstore, and sports.
3. The allowance is a **per-group, per-user, per-day** bucket pinned to **Asia/Bangkok** time. Canteen and Store buckets are completely independent.
4. Admin can create, edit, deactivate, and delete groups from a new admin page. Every shop must be assigned to exactly one group, or its POS will refuse to ring up a sale.
5. Behaviour follows existing project patterns — raw-SQL schema patches in `start.sh`, English-first bilingual UI, polymorphic-wallet-aware checkout, void restores the bucket, top-ups never consume the bucket.

---

## 1. Problem Summary

Today the system has only a per-customer daily limit on `customers.daily_limit` (single number applied to all spending). The school needs a smarter rule: students may spend up to ฿500/day on food (canteen) AND up to ฿25,000/day on goods (store) — **independently**, so a textbook purchase doesn't crowd out lunch.

The grouping must also be **future-proof** — when the school opens a new shop (e.g. uniforms), admin should be able to assign it to an existing group or create a new one, without code changes.

---

## 2. Confirmed Scope (locked)

| # | Decision | Locked value |
|---|---|---|
| 1 | Group → shop relationship | One shop belongs to exactly one group |
| 2 | Limit scope | One shared daily limit per group, same for every user |
| 3 | Seed groups | `canteen` (฿500), `store` (฿25,000) |
| 4 | Day boundary | 00:00–23:59 **Asia/Bangkok** |
| 5 | Bucket isolation | Canteen spend does not consume Store bucket, and vice versa |
| 6 | Admin control | Full CRUD via UI, code auto-generated or admin-typed (snake_case, unique) |
| 7 | Unassigned shop | POS rejects with clear error message |
| 8 | Group deletion with linked shops | Backend rejects with list of blocking shops |
| 9 | Void / refund | Subtracts from `spent_today` (bucket restored) |
| 10 | Top-up | Does **not** count against the limit |
| 11 | Role exemptions | None — admin/teacher/parent/student/staff all share the same limit |
| 12 | Bundle products | Counted at the bundle line total |
| 13 | Mid-day limit lowering | Block silently; toast on next purchase (decision #1) |
| 14 | Parent portal scope | Today only in v1 (decision #2) |
| 15 | Kiosk | Not modified (decision #3) |
| 16 | `is_active=false` semantics | Skip enforcement (decision #4) |

---

## 3. Database Design

### 3.1 New table — `spending_groups`

| Column | Type | Notes |
|---|---|---|
| `id` | `SERIAL PRIMARY KEY` | Internal numeric ID |
| `code` | `VARCHAR(40) UNIQUE NOT NULL` | snake_case, e.g. `canteen`, `store`, `uniforms` |
| `name_en` | `VARCHAR(100) NOT NULL` | Display name in English |
| `name_th` | `VARCHAR(100) NOT NULL` | Display name in Thai |
| `daily_limit` | `NUMERIC(10,2) NOT NULL` | THB; CHECK > 0 |
| `is_active` | `BOOLEAN NOT NULL DEFAULT true` | `true` = enforcement ON; `false` = skip check |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `updated_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |

Constraints:
- `CHECK (daily_limit > 0)`
- `UNIQUE (code)` — frontend must validate snake_case + uniqueness pre-flight too.

### 3.2 `shops` ALTER

Add `spending_group_id INTEGER NULL REFERENCES spending_groups(id) ON DELETE RESTRICT`.

Kept **NULLable** so the deploy doesn't break existing rows before backfill. Backfill runs in the same `start.sh` block. We deliberately do NOT migrate to NOT NULL in v1 — instead the POS rejects unassigned shops at runtime, giving admin time to fix without an outage.

### 3.3 `receipts` ALTER — snapshot column

Add `spending_group_id INTEGER NULL REFERENCES spending_groups(id) ON DELETE RESTRICT`.

**Why:** if a shop changes group mid-day, historical receipts need to stay attributed to the original group. Snapshotting at checkout time freezes the attribution.

### 3.4 Index strategy

```sql
CREATE INDEX IF NOT EXISTS ix_receipts_payer_shop_date
  ON receipts (payer_user_id, customer_id, payer_department_id, spending_group_id, transaction_date)
  WHERE status = 'ACTIVE';
```

### 3.5 Backfill plan (idempotent)

```sql
-- Seed canteen group
INSERT INTO spending_groups (code, name_en, name_th, daily_limit, is_active)
VALUES ('canteen', 'Canteen', 'โรงอาหาร', 500, true)
ON CONFLICT (code) DO NOTHING;

-- Seed store group
INSERT INTO spending_groups (code, name_en, name_th, daily_limit, is_active)
VALUES ('store', 'Store', 'ร้านค้า', 25000, true)
ON CONFLICT (code) DO NOTHING;

-- Assign existing shops by module
UPDATE shops SET spending_group_id = (SELECT id FROM spending_groups WHERE code='canteen')
WHERE module = 'canteen' AND spending_group_id IS NULL;

UPDATE shops SET spending_group_id = (SELECT id FROM spending_groups WHERE code='store')
WHERE module = 'store' AND spending_group_id IS NULL;
```

### 3.6 Raw SQL migration — to drop into `start.sh`

Following the deploy pitfalls memory: each statement runs in its own transaction; the **ALTER + FK is split into two statements** to dodge Railway log rate limits and transient lock contention.

```python
# === Phase 6: Spending Groups (Daily Spending Limit feature) ===
run('''
    CREATE TABLE IF NOT EXISTS spending_groups (
        id           SERIAL PRIMARY KEY,
        code         VARCHAR(40) UNIQUE NOT NULL,
        name_en      VARCHAR(100) NOT NULL,
        name_th      VARCHAR(100) NOT NULL,
        daily_limit  NUMERIC(10,2) NOT NULL,
        is_active    BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT chk_spending_groups_limit_positive CHECK (daily_limit > 0)
    )
''', 'spending_groups table')

run('CREATE INDEX IF NOT EXISTS ix_spending_groups_active ON spending_groups(is_active)',
    'spending_groups idx active')

# Seed two default groups (idempotent)
run("""INSERT INTO spending_groups (code, name_en, name_th, daily_limit) VALUES
       ('canteen','Canteen','โรงอาหาร', 500)
       ON CONFLICT (code) DO NOTHING""", 'spending_groups seed canteen', ok_if_exists=False)
run("""INSERT INTO spending_groups (code, name_en, name_th, daily_limit) VALUES
       ('store','Store','ร้านค้า', 25000)
       ON CONFLICT (code) DO NOTHING""", 'spending_groups seed store', ok_if_exists=False)

# shops.spending_group_id — split column-add and FK
run('ALTER TABLE shops ADD COLUMN IF NOT EXISTS spending_group_id INTEGER',
    'shops.spending_group_id (column only)')
run(
    "DO $$ BEGIN "
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='shops_spending_group_id_fkey') THEN "
    "    ALTER TABLE shops ADD CONSTRAINT shops_spending_group_id_fkey "
    "      FOREIGN KEY (spending_group_id) REFERENCES spending_groups(id) ON DELETE RESTRICT; "
    "  END IF; "
    "END $$;",
    'shops.spending_group_id (FK)',
)
run('CREATE INDEX IF NOT EXISTS ix_shops_spending_group ON shops(spending_group_id)',
    'shops idx spending_group')

# Backfill by module
run("UPDATE shops SET spending_group_id = (SELECT id FROM spending_groups WHERE code='canteen') "
    "WHERE module='canteen' AND spending_group_id IS NULL",
    'shops.spending_group_id backfill canteen', ok_if_exists=False)
run("UPDATE shops SET spending_group_id = (SELECT id FROM spending_groups WHERE code='store') "
    "WHERE module='store' AND spending_group_id IS NULL",
    'shops.spending_group_id backfill store', ok_if_exists=False)

# receipts.spending_group_id snapshot column
run('ALTER TABLE receipts ADD COLUMN IF NOT EXISTS spending_group_id INTEGER',
    'receipts.spending_group_id (column only)')
run(
    "DO $$ BEGIN "
    "  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='receipts_spending_group_id_fkey') THEN "
    "    ALTER TABLE receipts ADD CONSTRAINT receipts_spending_group_id_fkey "
    "      FOREIGN KEY (spending_group_id) REFERENCES spending_groups(id) ON DELETE RESTRICT; "
    "  END IF; "
    "END $$;",
    'receipts.spending_group_id (FK)',
)

# Hot-path index for spent-today aggregation
run("CREATE INDEX IF NOT EXISTS ix_receipts_payer_shop_date "
    "ON receipts (payer_user_id, customer_id, payer_department_id, spending_group_id, transaction_date) "
    "WHERE status = 'ACTIVE'",
    'receipts idx payer+group+date')
```

Add to `required_cols` / `required_tables` block in `start.sh`:

```python
('shops', 'spending_group_id'),
('receipts', 'spending_group_id'),
# and
'spending_groups',
```

### 3.7 Verification query (after deploy)

```sql
-- 1. Columns exist
SELECT 1 FROM pg_attribute a
  JOIN pg_class r ON r.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = r.relnamespace
  WHERE n.nspname='public' AND r.relname='shops'
  AND a.attname='spending_group_id' AND NOT a.attisdropped;

-- 2. Every shop has a group assigned
SELECT id, name, module, spending_group_id FROM shops WHERE spending_group_id IS NULL;
-- expected: zero rows
```

---

## 4. Backend (FastAPI / SQLAlchemy)

### 4.1 New model — `SpendingGroup`

Add `app/models/spending_group.py`. Add `spending_group_id` and `relationship("SpendingGroup")` to `Shop` in `app/models/shop.py` and to `Receipt` in `app/models/receipt.py`.

### 4.2 Pydantic schemas — new file `app/schemas/spending_group.py`

- `SpendingGroupCreate` — `code, name_en, name_th, daily_limit, is_active`
- `SpendingGroupUpdate` — all fields optional
- `SpendingGroupResponse` — model + `linked_shop_count` for the admin table

Validators:
- `code`: `^[a-z][a-z0-9_]{1,38}$` (snake_case, can't start with digit, ≤40 chars)
- `daily_limit`: `gt=0`
- Reject `code` collisions on POST/PATCH with 409.

### 4.3 New service — `app/services/spending_limit_service.py`

Single source of truth for "how much has this user spent today in this group". Requirements:

- Use **DB-side** day boundary, not Python's `datetime.now()`, to dodge clock skew.
- Pin to **Asia/Bangkok** explicitly (`AT TIME ZONE 'Asia/Bangkok'`).
- Sum only **ACTIVE** receipts (status filter — `VOIDED` excluded automatically).
- Sum across **all three payer columns** (customer_id, payer_user_id, payer_department_id).
- Use `receipts.total` (already includes bundle line items).
- Filter by **receipts.spending_group_id** (snapshot column) — NOT shop.spending_group_id — so historical attribution survives shop regroupings.

```python
def compute_spent_today(
    db: Session,
    *,
    payer_customer_id: int | None = None,
    payer_user_id: int | None = None,
    payer_department_id: int | None = None,
    spending_group_id: int,
) -> Decimal:
    """
    SELECT COALESCE(SUM(r.total),0)
    FROM receipts r
    WHERE r.status = 'ACTIVE'
      AND r.spending_group_id = :gid
      AND (r.transaction_date AT TIME ZONE 'Asia/Bangkok')::date
          = (now() AT TIME ZONE 'Asia/Bangkok')::date
      AND ( ... payer match ... )
    """
```

### 4.4 Checkout integration point

In `app/services/pos_service.py`, inside `PosService.checkout(...)`, between **line ~400** (where `total` is finalised) and **line ~408** (where wallet checks start). The check must run AFTER stock deduction validation but BEFORE wallet balance mutation.

Pseudo-code (planning only):

```
# After: bill_discount_amt, total computed
# Before: wallet balance read/write

if SettingsService.get_bool(db, "SPENDING_LIMIT_ENABLED", default=True):
    shop_row = ... (resolved shop)
    if shop_row.spending_group_id is None:
        raise BusinessRuleError(
            code="SHOP_NOT_ASSIGNED_SPENDING_GROUP",
            params={"shop_id": shop_row.id, "shop_name": shop_row.name},
            message="This shop has not been assigned a Spending Group. Please contact admin.",
        )
    group = ... (SpendingGroup by id)
    if group.is_active:  # decision #4: false → skip check entirely
        # Advisory lock — prevent two-terminal race
        db.execute(text("SELECT pg_advisory_xact_lock(:k1, :k2)"),
                   {"k1": hash_key('spending_limit'),
                    "k2": payer_group_key(payer_*, group.id)})
        spent = compute_spent_today(db, payer_customer_id, payer_user_id,
                                     payer_department_id, group.id)
        if spent + Decimal(str(total)) > Decimal(str(group.daily_limit)):
            remaining = max(Decimal(0), Decimal(str(group.daily_limit)) - spent)
            raise BusinessRuleError(
                code="DAILY_LIMIT_EXCEEDED",
                params={
                    "group_code": group.code,
                    "group_name_en": group.name_en,
                    "group_name_th": group.name_th,
                    "limit": float(group.daily_limit),
                    "spent_today": float(spent),
                    "remaining": float(remaining),
                    "attempted": float(total),
                },
                message=f"Daily limit reached for {group.name_en}. "
                        f"Remaining today: ฿{remaining:.2f}",
            )

# Snapshot spending_group_id onto Receipt at insert time
receipt.spending_group_id = group.id if shop_row.spending_group_id else None
```

**Important behaviour notes:**
- Uses `BusinessRuleError` → HTTP **400** with structured JSON. Never 500 (CORS would be lost per deploy-pitfalls memory).
- Existing `customer.daily_limit` check at `pos_service.py:468-475` is **left in place** (additive, not replaced) for v1.

### 4.5 Race-condition mitigation — `pg_advisory_xact_lock`

Two POS terminals scanning the same student simultaneously could both pass the limit check. Mitigation: an advisory lock on `(payer_id, spending_group_id, day)` using `pg_advisory_xact_lock`.

Reasoning:
- Simpler than `SELECT FOR UPDATE` on a synthetic row.
- Released automatically at transaction commit/rollback.
- Per-transaction = no cross-request deadlock risk.

### 4.6 API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/spending-groups` | admin | List groups with `linked_shop_count` |
| `GET` | `/api/v1/spending-groups/{id}` | admin | Single group detail |
| `POST` | `/api/v1/spending-groups` | admin | Create — 409 on duplicate code |
| `PATCH` | `/api/v1/spending-groups/{id}` | admin | Update name / limit / is_active |
| `DELETE` | `/api/v1/spending-groups/{id}` | admin | 409 if shops linked, with `{blocking_shops: [{id,name}]}` |
| `GET` | `/api/v1/spending-groups/{id}/usage-today` | any authenticated POS role | Query: `payer_user_id`/`payer_customer_id`/`payer_department_id`. Returns `{limit, spent_today, remaining}` |
| `GET` | `/api/v1/spending-groups/usage-today/by-child` | parent (linked customer only) | For parent dashboard card |
| `PATCH` | `/api/v1/shops/{id}` | admin | Existing endpoint — extend `ShopUpdate` to accept `spending_group_id` |

RBAC: matches existing shop endpoints (`is_superuser`). The `usage-today` endpoint scopes to JWT identity, not query param.

### 4.7 Settings flag

Add `SPENDING_LIMIT_ENABLED` to `app/core/config.py` (default `True`) or to `system_settings` table for admin toggle. Acts as kill-switch.

### 4.8 Tests

Per project memory, untracked backend tests are not ours to add. Documented cases for the developer to hand-test:
- `compute_spent_today` returns Decimal, sums only ACTIVE receipts
- Voided receipt drops out of the sum
- Bundle receipt's `total` is included
- Two concurrent checkouts → one succeeds, one gets `DAILY_LIMIT_EXCEEDED`
- Shop without group → `SHOP_NOT_ASSIGNED_SPENDING_GROUP`
- Day-boundary: receipt at 23:59 Bangkok counts to that day; receipt at 00:01 next day starts fresh bucket
- `is_active=false` → check is skipped entirely

---

## 5. Frontend (React admin + POS)

### 5.1 New page — `/admin/spending-groups`

Layout matches `/admin/shops` (DataTable + create/edit modal). Columns:

| Column | Source |
|---|---|
| Code | `code` |
| Name (English) | `name_en` |
| Name (Thai) | `name_th` |
| Daily Limit | `daily_limit` formatted as `฿{n.toLocaleString()}` |
| Linked Shops | `linked_shop_count` — clickable chip with popover list |
| **Enforce limit** | `is_active` switch (label: "Enforce limit / Don't enforce") |
| Actions | Edit, Delete |

Delete: confirmation modal. If backend returns 409 with `blocking_shops`, render names in red and tell admin to reassign first.

### 5.2 Extend Shop create/edit form

Add a `Select` dropdown labelled "Spending Group" — required on Create; on Edit, can be changed (warning toast: "Future purchases will count toward the new group. Today's existing purchases stay in the old bucket.").

### 5.3 POS — error toast (Canteen + Store)

When backend returns `{code: "DAILY_LIMIT_EXCEEDED", params: {...}}`:

- **English (primary):** `"Daily limit reached for {group_name_en}. Remaining today: ฿{remaining} of ฿{limit}."`
- **Thai:** `"เกินวงเงินกลุ่ม {group_name_th} วันนี้ คงเหลือ ฿{remaining} จาก ฿{limit}"`

Unassigned-shop error renders its own dedicated message pointing admin to fix configuration.

### 5.4 "Today's remaining" chip on POS

Small chip near cart total in `Canteen.tsx` and `Store.tsx`. Renders only after customer is scanned:

```
Canteen today: ฿312 / ฿500   [progress bar 62%]
Store today:   ฿0   / ฿25,000 [progress bar 0%]
```

Data source: `GET /spending-groups/{id}/usage-today?payer_...`, called when (a) customer is selected, (b) after every successful checkout.

Visual cue: amber at ≥80%, red at 100%, neutral grey if customer not yet scanned.

### 5.5 i18n keys (English first, then Thai)

| Key | English | Thai |
|---|---|---|
| `spendingGroup.title` | Spending Groups | กลุ่มวงเงินใช้จ่าย |
| `spendingGroup.subtitle` | Manage daily allowances shared across shops | จัดการวงเงินรายวันที่ใช้ร่วมกันระหว่างร้านค้า |
| `spendingGroup.code` | Code | รหัส |
| `spendingGroup.codeHint` | Lowercase letters, digits, underscores | ตัวพิมพ์เล็ก ตัวเลข และเครื่องหมายขีดล่าง |
| `spendingGroup.nameEn` | Name (English) | ชื่อ (อังกฤษ) |
| `spendingGroup.nameTh` | Name (Thai) | ชื่อ (ไทย) |
| `spendingGroup.dailyLimit` | Daily Limit | วงเงินต่อวัน |
| `spendingGroup.dailyLimitHint` | THB per day, per user | บาทต่อวัน ต่อผู้ใช้หนึ่งคน |
| `spendingGroup.linkedShops` | Linked Shops | ร้านค้าในกลุ่ม |
| `spendingGroup.enforce` | Enforce limit | บังคับใช้วงเงิน |
| `spendingGroup.dontEnforce` | Don't enforce | ไม่บังคับ |
| `spendingGroup.create` | New Spending Group | เพิ่มกลุ่มวงเงิน |
| `spendingGroup.edit` | Edit Spending Group | แก้ไขกลุ่มวงเงิน |
| `spendingGroup.delete` | Delete Spending Group | ลบกลุ่มวงเงิน |
| `spendingGroup.deleteConfirm` | This group will be removed. Continue? | ระบบจะลบกลุ่มนี้ ดำเนินการต่อหรือไม่ |
| `spendingGroup.deleteBlockedByShops` | Cannot delete — {{count}} shop(s) still linked | ลบไม่ได้ — ยังมีร้านค้า {{count}} ร้านในกลุ่มนี้ |
| `spendingGroup.duplicateCode` | A group with this code already exists | มีกลุ่มที่ใช้รหัสนี้แล้ว |
| `spendingGroup.changeWarning` | Future purchases will count toward the new group. Today's purchases stay in the old bucket. | การซื้อต่อจากนี้จะนับในกลุ่มใหม่ ส่วนยอดวันนี้ยังคงอยู่ในกลุ่มเดิม |
| `pos.dailyLimitReached` | Daily limit reached for {{group}}. Remaining today: ฿{{remaining}} of ฿{{limit}}. | เกินวงเงินกลุ่ม {{group}} วันนี้ คงเหลือ ฿{{remaining}} จาก ฿{{limit}} |
| `pos.shopMissingGroup` | This shop has not been assigned a Spending Group. Please contact admin. | ร้านนี้ยังไม่ได้กำหนดกลุ่มวงเงิน โปรดติดต่อผู้ดูแลระบบ |
| `pos.todayRemaining` | Today's remaining | คงเหลือวันนี้ |
| `pos.todayUsedOf` | {{spent}} of {{limit}} used | ใช้ไปแล้ว {{spent}} จาก {{limit}} |
| `parent.todayActivity` | Today's Activity | ยอดใช้จ่ายวันนี้ |
| `parent.todaySpentVsLimit` | Spent ฿{{spent}} of ฿{{limit}} | ใช้ไป ฿{{spent}} จาก ฿{{limit}} |

**Vocabulary:** "limit", "daily limit", "spending group", "allowance" — school-appropriate. Avoided: "cap", "ceiling", "quota", "throttle".

---

## 6. Parent Portal

Add **"Today's Activity"** card to parent dashboard, one row per child, one column per active spending group:

```
Somchai (Grade 7)
  Canteen: ฿312 / ฿500    [██████░░░░] 62%
  Store:   ฿0   / ฿25,000 [░░░░░░░░░░] 0%
```

Endpoint: `GET /api/v1/spending-groups/usage-today/by-child?customer_id=…` (admin authz: only parent linked to that customer).

History view is **NOT** in v1 (decision #2).

---

## 7. Kiosk

**Not modified in this feature** (decision #3). Kiosk continues to show balance only.

---

## 8. Sequence Diagram — Checkout with Limit Check

```
 Cashier UI            FastAPI                  PostgreSQL
     │                    │                          │
     │  POST /pos/checkout│                          │
     │ ───────────────────►                          │
     │                    │  BEGIN TXN              │
     │                    ├─────────────────────────►│
     │                    │  validate items, compute │
     │                    │  subtotal, discount,     │
     │                    │  total                   │
     │                    │                          │
     │                    │  resolve shop_id →       │
     │                    │  spending_group_id       │
     │                    ├─────────────────────────►│
     │                    │ ◄────────────────────────┤
     │                    │                          │
     │                    │  if group_id IS NULL:    │
     │                    │   raise SHOP_NOT_ASSIGNED│
     │                    │                          │
     │                    │  if group.is_active:     │
     │                    │   pg_advisory_xact_lock  │
     │                    │   (payer_id, group_id)   │
     │                    ├─────────────────────────►│
     │                    │                          │
     │                    │   compute_spent_today()  │
     │                    │   SUM(receipts.total) AT │
     │                    │   TZ Asia/Bangkok        │
     │                    ├─────────────────────────►│
     │                    │ ◄────────────────────────┤ Decimal
     │                    │                          │
     │                    │   if spent + total > limit
     │                    │     raise DAILY_LIMIT_   │
     │                    │       EXCEEDED → HTTP 400│
     │                    │                          │
     │                    │  wallet balance check    │
     │                    │  deduct stock            │
     │                    │  INSERT receipt          │
     │                    │  (with spending_group_id │
     │                    │   snapshot)              │
     │                    ├─────────────────────────►│
     │                    │  COMMIT                  │
     │                    ├─────────────────────────►│
     │                    │                          │
     │ ◄───────────────── │  201 ReceiptResponse     │
     │                    │                          │
     │  refresh chip:     │                          │
     │  GET /usage-today  │                          │
     │ ───────────────────►                          │
     │ ◄───────────────── │  {limit, spent, remaining}
```

---

## 9. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Two terminals race past the limit | Bucket overrun | `pg_advisory_xact_lock` keyed on payer + group inside transaction |
| Clock skew between app server & DB | Sales attributed to wrong day at midnight | Use DB-side `(now() AT TIME ZONE 'Asia/Bangkok')::date`; never Python `datetime.now()` |
| 5xx on limit check kills CORS | Frontend can't show toast | Use `BusinessRuleError` (HTTP 400) — explicitly NOT 500 |
| Migration runs before backfill on first boot | Existing shops have NULL group → POS rejects every sale | Backfill in same `start.sh` block, idempotent + feature flag `SPENDING_LIMIT_ENABLED=false` for first deploy |
| Admin lowers limit mid-day below current spent | Student already over the new limit | Block silently on next purchase + toast explains (decision #1). Save-time admin warning: "Users currently above this value will be blocked for the rest of today." |
| Shop reassigned mid-day | Bucket attribution confusion | `receipts.spending_group_id` snapshot freezes attribution |
| Voided receipt double-restores bucket | Bucket goes negative-spent | SUM filter is `status='ACTIVE'` — voided rows drop naturally |
| Top-up counted as spend | Bucket eaten by deposits | Top-ups create `wallet_transactions` rows, no `Receipt` — they don't appear in SUM(receipts.total) |
| Negative-ID bundle | Bypass via bundles? | Bundle receipt's `total` already aggregates line totals; product-ID sign is irrelevant since we sum receipts, not items |
| Admin deletes group while POS active | Open carts can't ring up | `ON DELETE RESTRICT` forces admin to reassign first; 409 with `blocking_shops` list |
| `code` field gets non-snake-case | URL collisions, log noise | Strict regex `^[a-z][a-z0-9_]{1,38}$` on both frontend and backend |
| `is_active=false` confuses cashier | Cashier expects block | Per decision #4: skip check entirely. UI label clearly says "Enforce limit / Don't enforce". Add banner on shop page if group is "Don't enforce" |

---

## 10. File-level Change Checklist

### Backend

| Path | Change | Reason |
|---|---|---|
| `backend/start.sh` | Add Phase 6 raw-SQL block (Section 3.6) | Create table, FKs, backfill, indexes |
| `backend/app/models/spending_group.py` | **NEW** — SpendingGroup ORM model | Persistence layer |
| `backend/app/models/__init__.py` | Import `SpendingGroup` | Make ORM aware |
| `backend/app/models/shop.py` | Add `spending_group_id` column + relationship | Link Shop ↔ SpendingGroup |
| `backend/app/models/receipt.py` | Add `spending_group_id` snapshot column + relationship | Freeze historical attribution |
| `backend/app/schemas/spending_group.py` | **NEW** — Pydantic Create/Update/Response | API contract |
| `backend/app/schemas/shop.py` | Add optional `spending_group_id` to ShopCreate/Update/Response | Surface in shop CRUD |
| `backend/app/services/spending_limit_service.py` | **NEW** — compute_spent_today, lock helpers, error builders | Business logic |
| `backend/app/services/pos_service.py` | Inject limit check (line ~400-408); snapshot `spending_group_id` onto Receipt | Enforcement |
| `backend/app/api/v1/spending_groups.py` | **NEW** — full CRUD router + usage-today endpoints | Admin + POS endpoints |
| `backend/app/api/v1/__init__.py` (or main router) | Register new router | Wire into FastAPI |
| `backend/app/api/v1/shops.py` | Surface `spending_group_id` in ShopResponse; accept in PATCH | Admin can reassign |
| `backend/app/core/config.py` | Add `SPENDING_LIMIT_ENABLED: bool = True` | Kill-switch |

### Frontend (React)

| Path | Change | Reason |
|---|---|---|
| `frontend/src/views/admin/SpendingGroups.tsx` | **NEW** — list + create/edit modal page | Admin UI |
| `frontend/src/router/...` | Register `/admin/spending-groups` route | Wire navigation |
| `frontend/src/components/admin/AdminSidebar.tsx` (or equivalent) | Add nav link | Discoverability |
| `frontend/src/views/admin/Shops.tsx` (Shop edit modal) | Add Spending Group dropdown | Required field on create |
| `frontend/src/views/canteen/Canteen.tsx` | Add "Today's remaining" chip | Cashier visibility |
| `frontend/src/views/store/Store.tsx` | Add "Today's remaining" chip | Symmetry |
| `frontend/src/plugins/ApiService/...` | Add typed clients for new endpoints | Type safety |
| `frontend/src/i18n/locales/en.json` | Add all keys in Section 5.5 | English-first |
| `frontend/src/i18n/locales/th.json` | Add Thai counterparts | Bilingual |
| `frontend/src/views/parent/Dashboard.tsx` | Add "Today's Activity" card | Parent transparency |
| `frontend/src/utils/errors.ts` (or equivalent) | Map `DAILY_LIMIT_EXCEEDED` + `SHOP_NOT_ASSIGNED_SPENDING_GROUP` to localised toasts | Error UX |

### Kiosk

**NOT MODIFIED** per decision #3.

---

## 11. Rollout Plan

### Phase 0 — Pre-deploy
- Code reviewed, merged to `main`.
- `SPENDING_LIMIT_ENABLED=false` in Railway env.
- Default seeded limits temporarily set to ฿10,000,000 each (effectively disabled).

### Phase 1 — Schema-only deploy
- Push to prod with flag OFF.
- Watch `start.sh` log for schema verification block.
- Run verification queries (Section 3.7).
- Confirm POS continues to work (flag OFF → limit check skipped entirely).

### Phase 2 — Admin UI live
- Browse `/admin/spending-groups`, see two seeded rows.
- Edit a group's limit; add/delete a dummy group.
- Confirm Shop edit form shows dropdown and saves.

### Phase 3 — Flip the flag
- Lower seed limits to real values: canteen=500, store=25000.
- Set `SPENDING_LIMIT_ENABLED=true`.
- Watch first 30 minutes of POS traffic for unexpected `DAILY_LIMIT_EXCEEDED`.
- Kill-switch: flag back to false skips the check instantly without redeploy.

### Phase 4 — Parent visibility
- Roll out parent dashboard card after enforcement stable for 1 week.

---

## 12. Acceptance Criteria (PASS / FAIL)

Reviewer runs this checklist on staging before approving merge:

- [ ] Migration applied; `pg_attribute` query confirms `shops.spending_group_id` and `receipts.spending_group_id` exist; `spending_groups` table exists with two seed rows.
- [ ] Every existing shop has non-NULL `spending_group_id` after backfill.
- [ ] Admin sees `/admin/spending-groups` with canteen=฿500 and store=฿25,000.
- [ ] Admin can create a new group (e.g. "Uniforms ฿2,000") and assign a shop to it.
- [ ] Admin attempts to delete the canteen group → 409 with `blocking_shops` listing.
- [ ] Reassigning every shop away from a group → that group becomes deletable.
- [ ] Saving a shop without `spending_group_id` blocked at admin UI; if forced via API, next POS sale shows `pos.shopMissingGroup` toast (not 500).
- [ ] Canteen POS: student with 0 spent attempts ฿501 → rejected with bilingual toast; remaining shown as ฿500.
- [ ] Store POS: single-line ฿25,001 → rejected.
- [ ] Cumulative: spend ฿24,990 in store, attempt ฿20 → rejected; attempt ฿10 → accepted.
- [ ] Void the last canteen receipt → bucket restored (next purchase up to ฿500 accepted).
- [ ] Two POS terminals (simultaneous Enter on same student) → only the one that fits succeeds; the other gets HTTP 400 with `DAILY_LIMIT_EXCEEDED` (not 500).
- [ ] Parent portal shows today's spend and remaining for each linked child, per group.
- [ ] All visible strings bilingual (EN+TH), school-appropriate (no "cap", "quota", "ceiling").
- [ ] Day boundary at Asia/Bangkok midnight verified.
- [ ] CORS preflight + response headers present on both 200 and 400 limit responses.
- [ ] Top-up via kiosk does NOT change `spent_today`.
- [ ] `SPENDING_LIMIT_ENABLED=false` skips the check entirely (kill-switch confirmed).
- [ ] Setting a group's `is_active=false` → enforcement skipped for that group, sales proceed unrestricted (decision #4).

---

## 13. Out of Scope (explicit)

- Per-user / per-role overrides — not in v1.
- Weekly or monthly limits — not in v1.
- Limits that vary by shop within a group — not in v1.
- Refunding partial line items — handled by existing void flow.
- Migrating per-customer `daily_limit` away — left in place; deprecation follow-up.
- **Parent history view (yesterday/last 7 days)** — decision #2, follow-up.
- **Kiosk display of limit/remaining** — decision #3, NOT planned.
- **Mass notifications on mid-day limit change** — decision #1, not built.

---

## 14. Reference Files (read by planner)

- `backend/start.sh` — raw SQL migration pattern (lines 67–816)
- `backend/app/models/shop.py` — Shop ORM (lines 40–83)
- `backend/app/models/receipt.py` — Receipt status, payer columns (lines 36–88)
- `backend/app/services/pos_service.py` — checkout entry point (line 216); existing daily-limit logic (lines 468–475); void flow (line 733)
- `backend/app/services/wallet_service.py` — `today_deducted` (lines 631–644). NOTE: this uses `date.today()` without timezone — pre-existing bug. Our new service uses `AT TIME ZONE 'Asia/Bangkok'` explicitly.
- `backend/app/api/v1/shops.py` — PATCH endpoint (lines 104–121)

---

## ภาษาไทย (สรุป)

### บทสรุปสำหรับผู้บริหาร

1. เพิ่มแนวคิดใหม่ชื่อ **"กลุ่มวงเงินใช้จ่าย" (Spending Group)** เพื่อรวมร้านค้าหลายร้านไว้ในกลุ่มเดียวกัน โดยใช้วงเงินรายวันร่วมกัน
2. ตั้งค่าเริ่มต้น 2 กลุ่ม คือ **โรงอาหาร (฿500/วัน)** และ **ร้านค้า (฿25,000/วัน)** โดยกลุ่มร้านค้าครอบคลุมร้านสหกรณ์ ร้านหนังสือ และร้านอุปกรณ์กีฬา
3. วงเงินคำนวณ **ต่อกลุ่ม ต่อผู้ใช้ ต่อวัน** ตามเขตเวลา **Asia/Bangkok** โดยกลุ่มโรงอาหารและกลุ่มร้านค้าแยกกระเป๋ากันชัดเจน
4. ผู้ดูแลระบบสร้าง แก้ไข ปิดใช้งาน หรือลบกลุ่มได้ผ่านหน้าจอใหม่ ทุกร้านต้องสังกัดกลุ่มใดกลุ่มหนึ่ง ไม่งั้น POS จะปฏิเสธการขาย
5. การออกแบบยึดแนวทางที่ทีมคุ้นเคยอยู่แล้ว — patches schema แบบ raw SQL ใน `start.sh`, UI ภาษาอังกฤษนำ ภาษาไทยรอง

### การตัดสินใจที่อนุมัติแล้ว 4 ข้อ

1. **ลดวงเงินกลางวัน** → บล็อกเงียบ + toast ตอนนักเรียนซื้อ (ไม่ต้องสร้าง notification system)
2. **Parent portal** → v1 โชว์แค่ยอดวันนี้ (history เป็น PR แยก)
3. **Kiosk** → **ไม่แตะ** ในงานนี้เลย โชว์ balance ตามเดิม
4. **`is_active=false`** → ข้ามการเช็ก (UI label = "บังคับใช้วงเงิน / ไม่บังคับ")

### แผนการ rollout

- **Phase 0:** Merge + flag OFF + seed ฿10M
- **Phase 1:** Deploy schema, ตรวจ pg_attribute
- **Phase 2:** เปิด admin UI ทดสอบ CRUD
- **Phase 3:** ลด seed เป็น 500/25000 + flip flag = true
- **Phase 4:** เปิด parent dashboard หลัง stable 1 สัปดาห์

### เกณฑ์ตรวจรับสำคัญ (ดูฉบับเต็มที่ Section 12)

- Migration สำเร็จ ทุกร้านมีกลุ่ม
- Admin CRUD ใช้งานได้
- ลบกลุ่มที่ยังมีร้านสังกัดไม่ได้
- POS ปฏิเสธการขายที่ทำให้เกินวงเงิน — toast EN+TH
- ทดสอบสะสม (24,990 + 20 = ปฏิเสธ, +10 = ผ่าน)
- Void แล้ววงเงินคืน
- POS 2 เครื่องชนกัน — 400 สะอาด ไม่ใช่ 500
- ขอบเขตวันแม่นที่เที่ยงคืน Bangkok
- CORS headers ครบทั้ง 200 และ 400
- `is_active=false` → ข้ามเช็ก ขายได้ปกติ

---

*End of plan document.*
