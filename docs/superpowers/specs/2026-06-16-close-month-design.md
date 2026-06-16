# Close Month — Design Spec
**Date:** 2026-06-16  
**Status:** Approved  
**Scope:** Store stock management — monthly period close with physical count and variance adjustment

---

## 1. Overview

Store managers need to reconcile system stock quantities against physical counts at the end of each month. The Close Month feature provides a structured workflow to snapshot system quantities, record physical counts (via UI or CSV), calculate variance, and auto-generate adjustment movements to bring the system in sync with reality.

---

## 2. Decisions Made

| Question | Decision |
|---|---|
| Goal | Report + physical count input + auto adjustment on variance |
| Period lock | Warning only — no hard lock on backdated movements |
| Who can close | Admin and Manager roles only |
| Physical count input | Both UI table and CSV export/import |
| Architecture | 2 new tables + reuse shop_movements for adjustments |

---

## 3. Data Model

### `stock_period_closes`
One row per shop per closed month.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `shop_id` | int FK → shops | |
| `period_year` | int | e.g. 2026 |
| `period_month` | int | 1–12 |
| `status` | enum `draft` / `closed` | draft = count in progress |
| `closed_by` | int FK → users nullable | set on confirm |
| `closed_at` | timestamptz nullable | set on confirm |
| `notes` | text nullable | optional remark |
| `created_at` | timestamptz | auto |

**Unique constraint:** `(shop_id, period_year, period_month)`

### `stock_period_close_items`
One row per product per close.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `close_id` | int FK → stock_period_closes | |
| `product_id` | int FK → products | |
| `system_qty` | numeric | snapshot at close creation time |
| `physical_qty` | numeric nullable | entered by user |
| `variance_qty` | numeric nullable | physical_qty − system_qty (computed) |
| `unit_cost` | numeric | avg_cost at close time |
| `variance_value` | numeric nullable | variance_qty × unit_cost |
| `adjustment_movement_id` | int FK → shop_movements nullable | created when variance ≠ 0 |

---

## 4. Frontend UI

### Navigation
Add "ปิดรอบเดือน" to the Store sidebar, same level as Stock and Sales.

### List Page — `/store/:shopId/close-month`
- Table: เดือน / สถานะ / ปิดโดย / วันที่ปิด
- Button: "+ เริ่มปิดรอบ" (Admin/Manager only)
- Click a closed row → read-only detail/report view

### Detail Page — `/store/:shopId/close-month/new` or `/:closeId`
Three tabs:

1. **นับสต๊อก** — table with columns: Product | System Qty | Physical Qty (input) | Variance (live computed)
2. **นำเข้า CSV** — download template button → upload CSV
3. **สรุป** — variance summary table + "ยืนยันปิดรอบ" button

**Warning banner:** shown when a movement exists with a timestamp that falls within an already-closed period — "มีรายการที่เกิดหลังการปิดรอบ ข้อมูลอาจไม่ตรง"

---

## 5. API Endpoints

Base: `/api/v1/shops/:shopId/close-month`  
Auth: Admin and Manager roles only.

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List all closes for the shop |
| `POST` | `/` | Create draft close (snapshot system_qty) |
| `GET` | `/:closeId` | Get detail + items |
| `PATCH` | `/:closeId/items` | Bulk save physical_qty entries |
| `POST` | `/:closeId/import-csv` | Import physical counts via CSV |
| `GET` | `/:closeId/export-csv` | Download CSV template or result |
| `POST` | `/:closeId/confirm` | Confirm close → create adjustments + set status=closed |

---

## 6. Data Flow

```
[Admin/Manager clicks "เริ่มปิดรอบ"]
        │
        ▼
POST /close-month
  → snapshot current system_qty + unit_cost for all products in shop
  → INSERT stock_period_closes  (status = draft)
  → INSERT stock_period_close_items  (physical_qty = null)
        │
        ▼
[User enters physical counts]
  Option A: type in UI table  → PATCH /:closeId/items
  Option B: download CSV → fill → upload  → POST /:closeId/import-csv
        │
        ▼
  variance_qty = physical_qty − system_qty   (live in UI)
  variance_value = variance_qty × unit_cost
        │
        ▼
[User clicks "ยืนยันปิดรอบ"]
        │
        ▼
POST /:closeId/confirm
  For each item where variance_qty ≠ 0:
    → INSERT shop_movements (type = "adjustment", qty = variance_qty,
                             ref_id = close_id, note = "ปิดรอบ <month> <year>")
    → UPDATE stock_period_close_items.adjustment_movement_id
  → UPDATE stock_period_closes (status = closed, closed_by, closed_at)
        │
        ▼
[List page shows closed period — detail is read-only]
```

### Warning Case
Any `shop_movements` row with `created_at` falling inside a period that is already `closed` → show banner on the close detail page. No hard block.

---

## 7. CSV Format

### Template (download)
```
product_id,product_name,system_qty,physical_qty
101,ข้าวหอมมะลิ,50,
102,น้ำมันพืช,20,
103,ไข่ไก่,200,
```

### Upload (import)
- Read `product_id` + `physical_qty` columns only
- Skip rows where `physical_qty` is blank
- Validate: product_id must exist in the close's items
- Return count of rows imported + list of skipped rows

---

## 8. Error & Edge Cases

| Case | Behavior |
|---|---|
| Close already exists for shop+month | Return 409, block duplicate |
| Confirm with some physical_qty still null | Block confirm, show count of unfilled rows |
| CSV has unknown product_id | Skip row, report in response |
| Movement backdated into closed period | Warning banner only, no block |
| Non-admin/manager tries to close | 403 Forbidden |

---

## 9. Out of Scope

- Hard period lock (no writes blocked after close)
- Automated scheduled closing
- Multi-shop batch close
- Cost restatement / historical recosting
