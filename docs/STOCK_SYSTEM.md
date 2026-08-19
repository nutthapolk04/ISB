# Stock & Inventory System — Technical Reference

> ฉบับภาษาไทย: [`STOCK_SYSTEM.th.md`](./STOCK_SYSTEM.th.md)

Everything below was read out of the code at the paths cited. Where behaviour is
surprising, the surprise is documented rather than smoothed over — this document
is meant to be enough to rebuild or extend the system, so the sharp edges matter
more than the happy path.

**Scope:** `backend-bun/src/services/shop_product_service.ts`,
`inventory_fifo.ts`, `lib/fifo.ts`, `admin_import_service.ts`,
`pos_checkout_service.ts`, `pos_service.ts`, `close_month_service.ts`,
`monthly_stock_service.ts`, `balance_file_service.ts`, `report_service.ts`.

---

## 1. Data model

### 1.1 Tables

| Table | Role |
|---|---|
| `shops` | Outlet. `shop_type` = `avg_cost` \| `fifo` decides the costing engine. `module` = `store` \| `canteen` decides UI/limits, **not** costing. |
| `shop_products` | The SKU. Holds live `stock` and live `avg_cost`. One row per product per shop — the same physical item in two shops is two rows. |
| `shop_movements` | Append-only ledger. Every stock change writes exactly one row. **This is the source of truth for all reports.** |
| `fifo_lots` | Open cost layers, FIFO shops only. Deleted and rewritten wholesale on every mutation. |
| `shop_categories` | Free-text grouping, unique per `(shop_id, name)`. |
| `units_of_measure` | Optional UoM with self-referencing `base_uom_id` + `conversion_factor`. Display only — no conversion is applied anywhere in the stock maths. |
| `product_bundles` / `bundle_items` | A sellable bundle that deducts its components. Bundles have **no stock of their own**. |
| `product_barcodes` | Additional scannable barcodes beyond `shop_products.barcode`. |
| `stock_period_closes` / `stock_period_close_items` | Month-end physical count and the variance adjustment it produces. |

Legacy and unused by this subsystem: `products`, `product_variants`,
`stock_levels`, `stock_movements`, `inventory_transactions`, `barcodes`. They
are remnants of the retired Python backend. **Do not write to them.**

### 1.2 Relationships

```
shops ──1:N──> shop_products ──1:N──> shop_movements      (ON DELETE SET NULL)
  │                  │
  │                  ├─1:N──> fifo_lots                   (ON DELETE CASCADE)
  │                  ├─1:N──> product_barcodes
  │                  ├─1:N──> bundle_items                (ON DELETE CASCADE)
  │                  └─1:N──> stock_period_close_items
  │
  ├─1:N──> shop_categories                                (ON DELETE CASCADE)
  ├─1:N──> product_bundles ──1:N──> bundle_items          (ON DELETE CASCADE)
  └─1:N──> stock_period_closes ──1:N──> stock_period_close_items

shop_movements.reverses_id     ──> shop_movements.id      (self, SET NULL)
shop_movements.reversed_by_id  ──> shop_movements.id      (self, SET NULL)
shop_products.uom_id           ──> units_of_measure.id
```

`shop_movements.product_id` is `ON DELETE SET NULL` and the table also carries a
denormalised `product_name`, so the ledger survives a hard product delete with
the name still readable. In practice products are **soft**-deleted
(`is_active = false`) — see §4.4.

### 1.3 `shop_products` — the live state

| Column | Type | Notes |
|---|---|---|
| `product_code` | varchar(50) | Unique **per shop among active rows only** — enforced in application code, not by a DB constraint. Two inactive rows may share a code. |
| `barcode` | varchar(100) | Primary barcode; extras live in `product_barcodes`. |
| `external_price` | numeric(10,2) | Public/customer price. |
| `internal_price` | numeric(10,2) | Staff price — **also overwritten by receive/adjust to equal `avg_cost`** on `avg_cost` shops. See §5.4. |
| `vat_percent` | numeric(5,2) | Default 7.0 when omitted at creation. |
| `avg_cost` | **numeric(10,4)** | Live weighted-average cost. 4 decimals on purpose: rounding to satang on every receive accumulates error. |
| `stock` | integer | **Whole units. May go negative** — nothing clamps it. |
| `min_stock` | integer | Low-stock threshold for `GET /shops/low-stock`. |
| `sort_order` | integer | Per-category display order. |

### 1.4 `shop_movements` — the ledger

| Column | Notes |
|---|---|
| `date` | **Entry date** (server local `YYYY-MM-DD`). Period slicing in Balance File and Monthly Stock uses this. |
| `type` | enum `receive` \| `sale` \| `adjustment` \| `internal_use` \| `void` \| `exchange` |
| `quantity` | **Sign convention is not uniform across types.** See §1.5. |
| `stock_before` / `stock_after` | Absolute stock either side. **Direction is derived from these, not from `quantity`.** |
| `cost_per_unit` | numeric(10,4). Meaning depends on type — see §1.5. |
| `sale_amount` | numeric(10,2). What was actually charged (`line_total`). Only on `sale`/`void`. |
| `reference` | Receipt number on sales; PO-or-invoice on receives (legacy, see below). |
| `po_number` / `invoice_number` | Receive rows only. Added because `reference` conflated the two and lost one. |
| `received_date` | Receive rows only. **Display only** — nothing sorts, filters or values by it. |
| `note` | Free text: adjustment reason, void reason, `"Initial stock"`, `"ปิดรอบ YYYY-MM"`. |
| `created_at` | **Stock Card orders and prices by this**, not by `date`. See §7.3. |

### 1.5 Sign conventions — read this before writing any query

| Type | `quantity` | `cost_per_unit` means | Direction |
|---|---|---|---|
| `receive` | `+qty` (negative = supplier return) | **what was paid** for this delivery | `stock_after > stock_before` |
| `sale` | `−qty` | the `avg_cost` **at the moment of sale** | out |
| `internal_use` | `−qty` | same as sale | out |
| `void` | `+qty` | `avg_cost` at void time | in |
| `adjustment` | `+delta` | the cost supplied by the caller, or NULL | either |
| `exchange` | varies | varies | either |

> **Rule:** derive direction from `stock_after − stock_before`, never from the
> sign of `quantity`. A negative-quantity `internal_use` is a *return* of
> requisitioned stock (an inflow); a negative-quantity `receive` is a supplier
> return (an outflow). Both report_service and balance_file_service do this.

---

## 2. Authorization

Every `/api/v1` route below sits behind `requireAuth` (`routes.ts:423`).

| Endpoint | Roles | Enforced at |
|---|---|---|
| `POST /shops/:shopId/products` | `admin`, `manager` | `ShopCatalogController.ts:336` |
| `PATCH /shops/:shopId/products/:productId` | any authenticated — **but non-admin/manager may only send `color`, `sort_order`, `short_name`** | `shop_product_service.ts:305` |
| `DELETE /shops/:shopId/products/:productId` | `admin`, `manager` | `ShopCatalogController.ts:376` |
| `POST /shops/:shopId/receive` | `admin`, `manager` | `ShopCatalogController.ts:397` |
| `POST /shops/:shopId/adjust` | `admin`, `manager` | `ShopCatalogController.ts:420` |
| `POST/PATCH/DELETE /shops/:shopId/categories…` | `admin`, `manager` | `ShopCatalogController.ts:446/465/484` |
| `POST /admin/import/{products,stock-receive,store}` | `admin`, `manager` | `AdminImportController.ts:12` |
| `POST /shops/:shopId/close-month/**` | see `ShopController` | — |

### ⚠️ Known gap — no per-shop scoping on stock writes

`receiveStock` and `adjustStock` take `shopId` straight from the URL and never
compare it against the caller's own `users.shop_id`
(`ShopCatalogController.ts:393–440`, `shop_product_service.ts:431/509`). The
service only checks that the shop exists (`shopOrThrow`) and that the product
belongs to that shop.

**A manager of shop A can receive and adjust stock in shop B.** Reports go
through `scopeShop()` (`report_service.ts:39`) and are correctly clamped; the
*write* paths are not. If you are extending this system, add the same clamp.

---

## 3. Costing engines

`shops.shop_type` selects the engine per shop. Both are implemented; the
`avg_cost` engine is what is deployed.

### 3.1 Weighted average (`shop_type = 'avg_cost'`)

`lib/fifo.ts:36` — the single formula used by the receive path, the adjust path,
and the UI preview:

```ts
calcNewAvgCost(currentStock, currentAvgCost, newQty, newCostPerUnit) {
  const totalValue = currentStock * currentAvgCost + newQty * newCostPerUnit;
  const totalQty   = currentStock + newQty;
  if (totalQty <= 0) return currentAvgCost;   // keeps the last known cost
  return totalValue / totalQty;
}
```

Rounded to 4 decimals by the caller (`Math.round(x * 10000) / 10000`).

**Only a receive moves the average.** A sale reduces quantity and leaves the
cost basis alone — that is the definition of weighted average, and every report
depends on it.

> **Negative stock inflates the average.** `currentStock` is not clamped. If 33
> units were sold before any delivery, stock is `−33`; receiving 400 @ ฿203.30
> gives `(−33 × 0 + 400 × 203.30) / 367 = ฿221.5804`. This is arithmetically
> correct — the full ฿81,320 spreads over the 367 units that actually exist —
> but it surprises everyone. Prevent negative stock at the POS rather than
> patching the formula; removing the negative term deletes ฿6,708.90 of cost
> from the books entirely.

### 3.2 FIFO (`shop_type = 'fifo'`)

`fifo_lots` holds open layers. Every mutation reads all lots for the product,
recomputes in memory, then `DELETE` + re-`INSERT`s the whole set
(`inventory_fifo.ts:48`).

| Operation | Behaviour |
|---|---|
| Receive | Append a lot at the paid cost (`fifoReceiveInTx`) |
| Sale / negative adjust | Drain oldest lot first by `date` (`deductFifoLotsInMemory`) |
| Exhausted lots | Append a **phantom lot with negative `qty_remaining`** at the newest lot's cost — negative stock is allowed here too |
| Void / refund | Open a fresh lot at the product's current `avg_cost` (`fifoRefundLot`) — no receipt linkage |
| Positive adjust | Cost precedence: caller's `cost_per_unit` → newest lot's cost → product `avg_cost` |

`shop_products.avg_cost` on a FIFO shop is a **derived display value**:
`Σ(qty × cost) / Σ(qty)` across remaining lots (`calcFifoAvgCost`).

### ⚠️ The two engines disagree on one edge case

| | when `totalQty <= 0` after the receive |
|---|---|
| `lib/fifo.ts:44` (POS, UI preview) | returns the **old** average |
| `balance_file_service.ts:87` `nextCostState` (Balance File, Stock Card) | returns the **incoming** cost |

Reachable only when a receive lands into stock so negative it stays ≤ 0
afterwards. Unify these if you extend the system.

---

## 4. Product lifecycle

### 4.1 Create — `POST /shops/:shopId/products`

Body (`shop_catalog.schema.ts` `createShopProduct`):

```jsonc
{
  "product_code": "string, 1–50, required",
  "name":         "string, 1–255, required",
  "external_price": 0,          // required, ≥ 0
  "barcode": null, "category": null,
  "internal_price": null,       // ≥ 0, defaults to external_price
  "vat_percent": null,          // 0–100, defaults to 7.0
  "avg_cost": null,             // ≥ 0, defaults to 0
  "stock": null,                // defaults to 0 — NO minimum, negatives accepted
  "min_stock": null,            // ≥ 0, defaults to 0
  "color": null, "uom_id": null
}
```

Service (`shop_product_service.ts:216`):

1. Shop must exist → else **404**.
2. `product_code` must not collide with an **active** row in the same shop → else **409 "Product code already exists in this shop"**.
3. Defaults applied: `internal_price ← external_price`, `vat_percent ← 7.0`, `category ← "ทั่วไป"`.
4. Insert with `is_active = true`, `sort_order = 0`.
5. **If `shop_type ≠ 'fifo'` and `stock > 0`**, write a `receive` movement with `note = 'Initial stock'` and `cost_per_unit = avg_cost`.

> **FIFO gap:** a FIFO shop creating a product with opening stock gets **no
> movement and no lot**. `shop_products.stock` says N, `fifo_lots` says nothing.
> The code comment calls this deferred.

> **`avg_cost` is accepted here and nowhere else** in the product CRUD surface —
> see §4.3.

### 4.2 Manual add via import — see §6

### 4.3 Update — `PATCH /shops/:shopId/products/:productId`

Editable: `product_code`, `barcode`, `name`, `category`, `external_price`,
`internal_price`, `vat_percent`, `min_stock`, `is_active`, `photo_url`,
`color`, `uom_id`, `short_name`, `sort_order`.

**Not editable — deliberately:**

- **`avg_cost`** — rejected at the schema level with a comment dated 2026-07:
  it may only change via receive or adjust. An admin hand-typing a number here
  used to silently override the real weighted average.
- **`stock`** — same reasoning; use receive or adjust so a movement is written.

Other rules:

- Non-admin/manager sending anything outside `{color, sort_order, short_name}` → **403** listing the offending fields.
- `uom_id: 0` is treated as "clear" → NULL.
- A change to `external_price` or `internal_price` writes an `audit_logs` row (`entity_type='shop_product'`, action `UPDATE`) with old/new values.

### 4.4 Delete — `DELETE /shops/:shopId/products/:productId`

**Soft delete only.** Sets `is_active = false` and writes an `audit_logs` row
with a snapshot of name, prices, stock and category. Movements, FIFO lots and
receipt history are untouched.

A hard `DELETE` is blocked in practice by
`receipt_items_product_variant_id_fkey` — you must delete the receipt lines
first, which destroys sales history. **Don't.**

---

## 5. Stock movements

### 5.1 Receive — `POST /shops/:shopId/receive`

```jsonc
{ "items": [                       // minItems 1
  { "product_id": 0,               // required
    "qty": 0,                      // required, ≠ 0 (negative = supplier return)
    "cost_per_unit": 0,            // required, ≥ 0
    "po": null, "invoice": null, "note": null,
    "received_date": "YYYY-MM-DD"  // optional
  } ] }
```

Per item, inside **one transaction for the whole batch**
(`shop_product_service.ts:431`):

1. `SELECT … FOR UPDATE` on the product **scoped to the shop** → **404** if absent.
2. `qty === 0` → **422 "qty cannot be 0"**.
3. `avg_cost` shop: `newStock = stockBefore + qty`, `newAvg = calcNewAvgCost(...)`.
   FIFO shop: `qty > 0` appends a lot; `qty < 0` drains oldest lots.
4. `UPDATE shop_products` — stock, avg_cost, and **`internal_price ← avg_cost` when the average changed and the shop is not FIFO**.
5. `INSERT shop_movements` type `receive`, `date = today (entry date)`, `received_date = normalised input or today`, both `reference` (legacy) and `po_number`/`invoice_number`.

`received_date` accepts **only** `^\d{4}-\d{2}-\d{2}$`; anything else silently
falls back to today (`normaliseReceivedDate`). Backdating it is safe by design —
nothing values or orders by it.

> **No period lock.** Receiving into a month that has already been closed is
> not blocked.

### 5.2 Adjust — `POST /shops/:shopId/adjust`

```jsonc
{ "product_id": 0, "delta": 0, "reason": "string, required, non-empty",
  "cost_per_unit": null }
```

- `delta === 0` → **422 "delta cannot be 0"**.
- Product must exist in the shop → **404**.
- `avg_cost` shop: stock moves by `delta`. **The average moves only when `cost_per_unit` is supplied**; omit it to move quantity without touching cost.
- FIFO shop: `fifoAdjustInTx` — negative drains lots, positive opens one.
- Writes `type = 'adjustment'` with `note = reason`.

> **Important asymmetry:** an adjustment with a cost changes
> `shop_products.avg_cost`, but Stock Card and Balance File **ignore it** —
> `nextCostState` only moves the average on `receive`. The stored value and the
> replayed value diverge from that point on. Use receive for anything meant to
> change cost.

### 5.3 Sale — via `POST /pos/checkout`

`pos_checkout_service.ts:604`. Per line, inside the checkout transaction:

1. `SELECT … FOR UPDATE` on `shop_products`.
2. FIFO: `fifoDeductInTx` writes back both stock and the recomputed avg. Non-FIFO: `stock = stockBefore − qty`, avg untouched.
3. `INSERT shop_movements` with `quantity = −qty`, `cost_per_unit = avg_cost at sale time`, `sale_amount = line_total`, `reference = receipt_number`.

`transaction_mode = 'INTERNAL_ISSUE'` writes `type = 'internal_use'` instead of
`'sale'` (`pos_checkout_service.ts:475`); everything else is identical.

**There is no stock availability check.** Selling past zero is allowed and
drives `stock` negative. Canteen shops deduct exactly like store shops — the
`module` flag only affects daily spending limits and which reports the UI
exposes, never the ledger.

**Bundles** resolve to their components: each `bundle_items` row deducts
`component.quantity × bundle qty` and writes its own movement. The bundle itself
has no stock row.

### 5.4 Void — `POST /pos/receipts/:id/void`

`pos_service.ts:605`. Per line: `stock_after = stock_before + quantity`, a
`type = 'void'` movement at the **current** `avg_cost`, and on FIFO a fresh
refund lot. Bundles restore each component separately.

### 5.5 Requisition — `POST /shops/:shopId/requisition`

`ShopController.ts:469`. A thin wrapper that builds a checkout with
`transaction_mode = 'INTERNAL_ISSUE'`:

- Requester must exist and be **active** → else **404 / 400**.
- Every line's product must belong to the shop → else **404**.
- `pay_mode: 'department'` requires `payer_department_id` → else **422**. Allowed at every shop; the old `shops.allow_department_charge` gate was removed.
- `pay_mode: 'free'` sets `price_override = 0`.
- Unit price = `internal_price` if set, else `external_price`.

### 5.6 Month-end close — `/shops/:shopId/close-month/**`

`close_month_service.ts`.

| Step | Endpoint | Behaviour |
|---|---|---|
| Open | `POST /close-month` | Snapshots **every active product**'s `stock` → `system_qty` and `avg_cost` → `unit_cost`. `UNIQUE(shop_id, period_year, period_month)` → **409** on a repeat. |
| Count | `PATCH /close-month/:id/items` or `POST …/import-excel` | Fill `physical_qty`. |
| Confirm | `POST /close-month/:id/confirm` | See below. |

Confirm:

1. Status already `closed` → **409**.
2. Any item with `physical_qty === null` → **422 "N item(s) still need physical count"**.
3. Per item: `variance = physical − system`. Zero variance writes no movement.
4. Non-zero variance → an `adjustment` movement with `note = "ปิดรอบ YYYY-MM"`, `UPDATE shop_products.stock`, and `adjustment_movement_id` linked back on the close item.
5. `variance_value = variance × unit_cost` — the cost is the one **frozen when the period was opened**, not today's.
6. Status → `closed`, `closed_by`, `closed_at`.

> Confirming a close does **not** lock the period. Later receives, sales and
> adjustments dated inside a closed month are still accepted and will change
> reports for that period.

---

## 6. Bulk import

`POST /admin/import/store` (single sheet, current), plus the legacy
`/products` and `/stock-receive`. Roles: `admin`, `manager`.
`?dry_run=1` validates and reports without writing.

### 6.1 Template

`GET /admin/import/template?shop_id=…` returns an xlsx. Store columns:

```
product_code | product_name | barcode | external_price | internal_price |
category | uom | shop_id | stock | cost_per_unit | notes | reference
```

Canteen shops get a catalog-only template — no `stock` / `cost_per_unit` /
`notes` / `reference`, because canteens don't track per-SKU stock in the UI.

A workbook containing **both** a `Products` and a `StockReceive` sheet takes the
legacy two-sheet path; anything else reads the first sheet.

### 6.2 Row processing (`processCombinedRows`, `admin_import_service.ts:524`)

Rows are processed in **parallel batches of 20**. Each row is classified:

- `hasProductData` = `name` **and** `external_price` **and** `internal_price` all present → upsert the product.
- `hasStockData` = `stock` present **and ≠ 0** → queue a `receiveStock()` call.

Validation, per row (errors are collected and returned, they do not abort the import):

| Condition | Message |
|---|---|
| no `product_name` | `ต้องระบุ 'name' (ชื่อสินค้า)` |
| `external_price` not numeric | `'price' (ราคาขาย) ต้องเป็นตัวเลข` |
| `internal_price` not numeric | `'cost_price' (ต้นทุน) ต้องเป็นตัวเลข` |
| unknown `shop_id` | `ไม่พบร้าน '<id>' ในระบบ` |
| manager importing another shop | `Manager รับสต็อกได้เฉพาะร้านของตัวเองเท่านั้น` |
| stock row with no matching product | `ไม่พบสินค้าสำหรับรับสต็อก — ต้องระบุ name/price/cost_price หรือ barcode ที่มีอยู่` |

Note the stock sheet **does** clamp managers to their own shop; the direct
`POST /shops/:shopId/receive` endpoint does not (§2).

### 6.3 Upsert semantics

Match order: `product_code` → else `name`, within the shop.

**Existing product** — updates `name`, `external_price`, `internal_price`,
`category`, optional `uom_id` / `product_code`. **Never touches `avg_cost` or
`stock`.**

**New product** — code is the given `product_code` or a generated
`IMP-<8 digits><hex>`; inserted with `stock = 0`, `vat_percent = 0`,
`is_active = true`, and:

```ts
const openingCost = coerceNum(row.cost_per_unit) ?? costVal;   // :194
avgCost: String(openingCost),                                   // :292
```

`cost_per_unit` (the delivery-cost column) wins; `internal_price` is the
fallback for catalog-only rows.

> **This line was a bug until 2026-08.** `avg_cost` was hard-coded to `"0.0000"`,
> and because `hasStockData` skips rows with `stock = 0`, no `receiveStock()`
> ever ran to fix it. A catalog-only row landed with cost 0 permanently, its
> first sales were costed at ฿0, and stock went negative at zero cost. Since a
> row with `stock > 0` *does* call `receiveStock()` — which recomputes the
> average from `stockBefore = 0` and lands on exactly `cost_per_unit` — the two
> paths looked identical in testing while diverging in production. If you port
> this importer, keep the seed.
>
> Report-side companion fix: `balance_file_service.ts:244` falls back to
> `shop_products.avg_cost` when a product has no movement history before the
> reported period, so a stock-0 import is priced correctly in the ledger too.

Stock rows then call the same `receiveStock()` as the manual endpoint, so the
movement, the FIFO lot and the average are produced identically.

---

## 7. Reads and reports

### 7.1 Endpoints

| Endpoint | Returns |
|---|---|
| `GET /shops/:shopId/products` | Catalog + live `stock`, `avg_cost`, extra barcodes, UoM, `has_options` |
| `GET /shops/low-stock` | Products where `stock <= min_stock` |
| `GET /shops/:shopId/movements` | Raw ledger, filterable |
| `GET /shops/:shopId/products/:id/fifo-lots` | Open FIFO layers |
| `GET /shops/:shopId/monthly-stock-report` (+ `/export`) | Per-product received / sold / internal use / adjustment |
| `GET /shops/:shopId/balance-file` (+ `/export`) | Monthly cost ledger with running average |
| `GET /reports/stock-card` | Per-product movement card |
| `GET /reports/receive-stock` | Goods-receipt log with PO / invoice |

### 7.2 Monthly stock report

`monthly_stock_service.ts:18` — sliced by `shop_movements.date`:

```
received     = Σ quantity          where type = 'receive'
sold         = Σ quantity          where type = 'sale'
internal_use = Σ quantity          where type IN ('internal_use','exchange')
adjustment   = Σ (stock_after − stock_before) where type = 'adjustment'
net change   = received − sold − internal_use + adjustment
```

Note `adjustment` uses the stock delta while the others use `quantity` — that is
the sign-convention rule from §1.5 in practice.

### 7.3 Stock Card vs Balance File — they are not interchangeable

Both replay `shop_movements` through the **same** `nextCostState()`
(`balance_file_service.ts:78`), which Stock Card imports. They still differ:

| | Stock Card | Balance File |
|---|---|---|
| Shop filter | none — `product_id` only | `shop_movements.shop_id` |
| Period slicing | `created_at` | `date` |
| Ordering | `created_at` | `date, created_at, id` |
| Products | the one selected | all `is_active = true` |
| Cost column | one column: receive rows echo the **stored `cost_per_unit`**, other rows show the average *before* the row | three: `in_unit_cost`, `out_avg_cost`, and **`bal_avg_cost` = running average *after* the row** |
| Amount out | **cost basis** (`qty × avg`) | **revenue** (`sale_amount`) when present |
| Opening cost with no prior history | falls back to `shop_products.avg_cost` | same (added 2026-08) |

Consequences worth knowing before you trust a comparison:

- A receive row in Stock Card **always shows what was typed**, so it cannot be used to confirm the average is right. Only Balance File's `bal_avg_cost` shows the computed figure.
- **Amount Out is not comparable** between the two — one is cost, the other is revenue. This is deliberate and documented in the code with a "do not re-align them" note.
- Quantity columns and Amount In are comparable.

### 7.4 The replay formula

```ts
nextCostState(state, { type, quantity, costPerUnit, stockAfter }) {
  if (type === "receive") {
    const newQty = state.qty + quantity;
    return { qty: newQty,
             avg: newQty > 0
                  ? (state.qty * state.avg + quantity * cost) / newQty
                  : cost };
  }
  return { qty: stockAfter, avg: state.avg };   // absolute, average unchanged
}
```

Two properties follow, and both matter:

- **Only receive rows move the average.** Editing `cost_per_unit` on a sale row changes nothing in either report.
- **Non-receive rows set quantity absolutely from `stock_after`.** The replay self-corrects after any gap in the ledger — but it also means reordering rows changes the result, because the weighted average is order-dependent.

---

## 8. Invariants and rules

**Guaranteed**

1. Every stock change writes exactly one `shop_movements` row, inside the same transaction as the `shop_products` update.
2. `shop_products` rows are locked `FOR UPDATE` before any read-modify-write.
3. `stock_before` / `stock_after` are contiguous per product when ordered by `created_at`.
4. Movements are never updated or deleted by application code — corrections are new rows.
5. `avg_cost` is only writable through receive, adjust, checkout, void and close-month.

**Explicitly allowed**

- Negative `stock` (both engines).
- A negative-quantity receive (supplier return), which unwinds the value it added.
- Selling with no stock.
- Receiving into a closed period.
- Inactive products keeping stock and history.
- Duplicate `product_code` across inactive rows.

**Not enforced anywhere**

- Per-shop authorization on receive/adjust (§2).
- Stock availability at checkout.
- Period locking after close (§5.6).
- UoM conversion — `conversion_factor` is never applied.
- FIFO lots for a product created with opening stock (§4.1).

---

## 9. Extending this system

If you are lifting the stock engine into another project:

1. **Take `shop_movements` as the primary artefact.** `shop_products.stock` and `.avg_cost` are caches of the ledger; every report rebuilds from movements. Keeping both means keeping them reconcilable — write a check that replays the ledger and compares.
2. **Use one costing function.** The single biggest class of bug in this codebase was two implementations of "the average cost" drifting apart: `lib/fifo.ts:36` (live) vs `balance_file_service.ts:78` (replayed). They still disagree on the `totalQty <= 0` edge.
3. **Decide about negative stock up front.** Allowing it is a valid choice, but then every cost calculation must be written knowing the quantity term can be negative, and the UI must explain the resulting averages.
4. **Never let a UI seed a cost without a movement.** The import bug in §6.3 and the adjustment asymmetry in §5.2 are the same mistake in two places: state changed where the ledger did not.
5. **Add the shop clamp** on write paths before the system is multi-tenant in anything but name.
