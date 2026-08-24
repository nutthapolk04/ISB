# ระบบ Stock & Inventory — เอกสารอ้างอิงทางเทคนิค

> ฉบับภาษาไทยของ [`STOCK_SYSTEM.md`](./STOCK_SYSTEM.md) — เนื้อหาตรงกันทุกข้อ
> ชื่อ table / column / function / endpoint / error message คงเป็นภาษาอังกฤษตามของจริงในระบบ

ทุกอย่างด้านล่างอ่านมาจากโค้ดจริงตาม path ที่อ้างอิงไว้ จุดไหนที่พฤติกรรมผิดคาด
ผมเขียนไว้ตรงๆ ไม่กลบ — เพราะเอกสารนี้มีไว้ให้สร้างใหม่หรือต่อยอดได้ ข้อควรระวัง
จึงสำคัญกว่า happy path

**ขอบเขต:** `backend-bun/src/services/shop_product_service.ts`,
`inventory_fifo.ts`, `lib/fifo.ts`, `admin_import_service.ts`,
`pos_checkout_service.ts`, `pos_service.ts`, `close_month_service.ts`,
`monthly_stock_service.ts`, `balance_file_service.ts`, `report_service.ts`

---

## 1. โครงสร้างข้อมูล

### 1.1 ตาราง

| Table | หน้าที่ |
|---|---|
| `shops` | ร้าน · `shop_type` = `avg_cost` \| `fifo` เป็นตัวเลือกวิธีคิดต้นทุน · `module` = `store` \| `canteen` มีผลกับ UI และ limit เท่านั้น **ไม่เกี่ยวกับต้นทุน** |
| `shop_products` | ตัวสินค้า เก็บ `stock` และ `avg_cost` ปัจจุบัน · 1 แถวต่อ 1 สินค้าต่อ 1 ร้าน — ของชิ้นเดียวกันขาย 2 ร้าน = 2 แถว |
| `shop_movements` | ledger แบบ append-only · ทุกการเปลี่ยนแปลงสต็อกเขียน 1 แถวเสมอ **นี่คือแหล่งความจริงของทุกรายงาน** |
| `fifo_lots` | ชั้นต้นทุนที่ยังเหลือ เฉพาะร้าน FIFO · ทุกครั้งที่แก้จะ ลบทิ้งทั้งชุดแล้วเขียนใหม่ |
| `shop_categories` | หมวดหมู่ · unique ที่ `(shop_id, name)` |
| `units_of_measure` | หน่วยนับ มี `base_uom_id` ชี้ตัวเอง + `conversion_factor` · **ใช้แสดงผลอย่างเดียว ไม่มีการแปลงหน่วยที่ไหนเลยในการคำนวณสต็อก** |
| `product_bundles` / `bundle_items` | ชุดสินค้าที่ขายแล้วหักส่วนประกอบ · **bundle ไม่มีสต็อกของตัวเอง** |
| `product_barcodes` | barcode เพิ่มเติมนอกเหนือจาก `shop_products.barcode` |
| `stock_period_closes` / `stock_period_close_items` | การนับสต็อกปิดงวด และ adjustment ที่เกิดจากผลต่าง |

ตารางที่เป็นของเก่าและ **subsystem นี้ไม่ใช้เลย**: `products`, `product_variants`,
`stock_levels`, `stock_movements`, `inventory_transactions`, `barcodes` —
เป็นซากจาก backend Python ที่เลิกใช้แล้ว **ห้ามเขียนลงตารางพวกนี้**

### 1.2 ความสัมพันธ์

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

shop_movements.reverses_id     ──> shop_movements.id      (ชี้ตัวเอง, SET NULL)
shop_movements.reversed_by_id  ──> shop_movements.id      (ชี้ตัวเอง, SET NULL)
shop_products.uom_id           ──> units_of_measure.id
```

`shop_movements.product_id` เป็น `ON DELETE SET NULL` และตารางยังเก็บ
`product_name` ซ้ำไว้ด้วย ledger จึงอยู่รอดแม้สินค้าถูกลบจริงและยังอ่านชื่อได้
ในทางปฏิบัติสินค้าถูกลบแบบ **soft delete** (`is_active = false`) — ดู §4.4

### 1.3 `shop_products` — สถานะปัจจุบัน

| Column | Type | หมายเหตุ |
|---|---|---|
| `product_code` | varchar(50) | ไม่ซ้ำ **ต่อร้าน เฉพาะแถวที่ active** — บังคับใน application code ไม่ใช่ DB constraint · แถว inactive ใช้โค้ดซ้ำกันได้ |
| `barcode` | varchar(100) | barcode หลัก · ตัวเสริมอยู่ใน `product_barcodes` |
| `external_price` | numeric(10,2) | ราคาขายทั่วไป |
| `internal_price` | numeric(10,2) | ราคาพนักงาน — **ถูกเขียนทับให้เท่ากับ `avg_cost` ทุกครั้งที่ receive/adjust** บนร้าน `avg_cost` ดู §5.4 |
| `vat_percent` | numeric(5,2) | default 7.0 เมื่อไม่ระบุตอนสร้าง |
| `avg_cost` | **numeric(10,4)** | ต้นทุนเฉลี่ยถ่วงน้ำหนักปัจจุบัน · **4 ตำแหน่งโดยตั้งใจ** เพราะปัดเหลือสตางค์ทุกครั้งที่ receive จะสะสมความคลาดเคลื่อน |
| `stock` | integer | **จำนวนเต็ม และติดลบได้** ไม่มีอะไร clamp |
| `min_stock` | integer | เกณฑ์ low stock สำหรับ `GET /shops/low-stock` |
| `sort_order` | integer | ลำดับแสดงผลต่อหมวด |

### 1.4 `shop_movements` — ledger

| Column | หมายเหตุ |
|---|---|
| `date` | **วันที่บันทึก** (`YYYY-MM-DD` ตามเวลาเครื่อง) · Balance File และ Monthly Stock ตัดช่วงด้วยคอลัมน์นี้ |
| `type` | enum `receive` \| `sale` \| `adjustment` \| `internal_use` \| `void` \| `exchange` |
| `quantity` | **เครื่องหมายไม่เหมือนกันในแต่ละ type** ดู §1.5 |
| `stock_before` / `stock_after` | สต็อกก่อน/หลังแบบสัมบูรณ์ · **ทิศทางดูจากสองค่านี้ ไม่ใช่จาก `quantity`** |
| `cost_per_unit` | numeric(10,4) · ความหมายขึ้นกับ type ดู §1.5 |
| `sale_amount` | numeric(10,2) · เงินที่เก็บได้จริง (`line_total`) มีเฉพาะ `sale`/`void` |
| `reference` | เลขที่ใบเสร็จตอนขาย · PO หรือ invoice ตอนรับของ (ของเก่า ดูด้านล่าง) |
| `po_number` / `invoice_number` | เฉพาะแถว receive · เพิ่มมาเพราะ `reference` เก็บได้ค่าเดียวแล้วอีกค่าหาย |
| `received_date` | เฉพาะแถว receive · **แสดงผลอย่างเดียว** ไม่มีอะไร sort/filter/คิดเงินจากคอลัมน์นี้ |
| `note` | ข้อความอิสระ: เหตุผล adjustment, เหตุผล void, `"Initial stock"`, `"ปิดรอบ YYYY-MM"` |
| `created_at` | **Stock Card เรียงและคิดต้นทุนด้วยคอลัมน์นี้** ไม่ใช่ `date` ดู §7.3 |

### 1.5 เครื่องหมาย — อ่านก่อนเขียน query ใดๆ

| Type | `quantity` | `cost_per_unit` คือ | ทิศทาง |
|---|---|---|---|
| `receive` | `+qty` (ติดลบ = คืนของซัพพลายเออร์) | **ราคาที่จ่ายจริง** ของล็อตนั้น | เข้า |
| `sale` | `−qty` | `avg_cost` **ณ ขณะที่ขาย** | ออก |
| `internal_use` | `−qty` | เหมือน sale | ออก |
| `void` | `+qty` | `avg_cost` ณ เวลาที่ยกเลิก | เข้า |
| `adjustment` | `+delta` | ต้นทุนที่ผู้เรียกส่งมา หรือ NULL | ได้ทั้งสองทาง |
| `exchange` | ไม่แน่นอน | ไม่แน่นอน | ได้ทั้งสองทาง |

> **กฎ:** หาทิศทางจาก `stock_after − stock_before` เท่านั้น ห้ามดูเครื่องหมายของ
> `quantity` · `internal_use` ที่ quantity ติดลบคือการ *คืน* ของที่เบิกไป (ของเข้า)
> ส่วน `receive` ที่ติดลบคือคืนของให้ซัพพลายเออร์ (ของออก) ·
> ทั้ง report_service และ balance_file_service ทำแบบนี้

---

## 2. สิทธิ์การเข้าถึง

ทุก route ด้านล่างอยู่หลัง `requireAuth` (`routes.ts:423`)

| Endpoint | Role | บังคับที่ |
|---|---|---|
| `POST /shops/:shopId/products` | `admin`, `manager` | `ShopCatalogController.ts:336` |
| `PATCH /shops/:shopId/products/:productId` | ใครก็ได้ที่ login — **แต่ถ้าไม่ใช่ admin/manager ส่งได้แค่ `color`, `sort_order`, `short_name`** | `shop_product_service.ts:305` |
| `DELETE /shops/:shopId/products/:productId` | `admin`, `manager` | `ShopCatalogController.ts:376` |
| `POST /shops/:shopId/receive` | `admin`, `manager` | `ShopCatalogController.ts:397` |
| `POST /shops/:shopId/adjust` | `admin`, `manager` | `ShopCatalogController.ts:420` |
| `POST/PATCH/DELETE /shops/:shopId/categories…` | `admin`, `manager` | `ShopCatalogController.ts:446/465/484` |
| `POST /admin/import/{products,stock-receive,store}` | `admin`, `manager` | `AdminImportController.ts:12` |
| `POST /shops/:shopId/close-month/**` | ดู `ShopController` | — |

### ⚠️ ช่องโหว่ที่รู้อยู่ — write path ไม่ได้จำกัดร้าน

`receiveStock` กับ `adjustStock` รับ `shopId` จาก URL ตรงๆ และ**ไม่เคยเทียบกับ
`users.shop_id` ของผู้เรียก** (`ShopCatalogController.ts:393–440`,
`shop_product_service.ts:431/509`) · service เช็กแค่ว่าร้านมีอยู่จริง
(`shopOrThrow`) และสินค้าอยู่ในร้านนั้น

**manager ของร้าน A รับของและปรับสต็อกในร้าน B ได้** · ฝั่งรายงานผ่าน
`scopeShop()` (`report_service.ts:39`) และถูก clamp ถูกต้อง แต่ฝั่ง *write* ไม่มี ·
ถ้าจะต่อยอดระบบนี้ ให้เติม clamp ตัวเดียวกันเข้าไป

---

## 3. เครื่องคิดต้นทุน

`shops.shop_type` เลือกวิธีคิดต่อร้าน · มีทั้งสองแบบในโค้ด แต่ที่ deploy จริงคือ `avg_cost`

### 3.1 เฉลี่ยถ่วงน้ำหนัก (`shop_type = 'avg_cost'`)

`lib/fifo.ts:36` — สูตรเดียวที่ใช้ทั้งตอน receive, ตอน adjust และตอน preview บน UI

```ts
calcNewAvgCost(currentStock, currentAvgCost, newQty, newCostPerUnit) {
  const totalValue = currentStock * currentAvgCost + newQty * newCostPerUnit;
  const totalQty   = currentStock + newQty;
  if (totalQty <= 0) return currentAvgCost;   // keeps the last known cost
  return totalValue / totalQty;
}
```

ผู้เรียกปัดเป็น 4 ตำแหน่ง (`Math.round(x * 10000) / 10000`)

**มีแต่ receive เท่านั้นที่ขยับค่าเฉลี่ย** · การขายลดจำนวนแต่ไม่แตะฐานต้นทุน —
นั่นคือนิยามของเฉลี่ยถ่วงน้ำหนัก และทุกรายงานพึ่งพาข้อนี้

> **สต็อกติดลบทำให้ค่าเฉลี่ยพองขึ้น** · `currentStock` ไม่ถูก clamp · ถ้าขายไป
> 33 ชิ้นก่อนของมาถึง สต็อกจะเป็น `−33` พอรับ 400 ชิ้น @ ฿203.30 จะได้
> `(−33 × 0 + 400 × 203.30) / 367 = ฿221.5804` · **เลขนี้ถูกต้องทางคณิตศาสตร์** —
> ฿81,320 ทั้งก้อนกระจายบนของที่มีจริง 367 ชิ้น — แต่ทุกคนจะงง ·
> **ทางแก้คือกันไม่ให้สต็อกติดลบที่ POS ไม่ใช่ไปแก้สูตร** เพราะถ้าตัดพจน์ติดลบทิ้ง
> เงิน ฿6,708.90 จะหายออกจากบัญชีไปเลย

### 3.2 FIFO (`shop_type = 'fifo'`)

`fifo_lots` เก็บชั้นต้นทุนที่ยังเปิดอยู่ · ทุกครั้งที่แก้จะอ่านทุก lot ของสินค้านั้น
คำนวณใหม่ในหน่วยความจำ แล้ว `DELETE` + `INSERT` ใหม่ทั้งชุด (`inventory_fifo.ts:48`)

| การกระทำ | พฤติกรรม |
|---|---|
| Receive | เพิ่ม lot ใหม่ที่ราคาที่จ่าย (`fifoReceiveInTx`) |
| ขาย / adjust ติดลบ | ตัดจาก lot เก่าสุดก่อนตาม `date` (`deductFifoLotsInMemory`) |
| lot หมด | เพิ่ม **phantom lot ที่ `qty_remaining` ติดลบ** ที่ต้นทุนของ lot ล่าสุด — ติดลบได้เช่นกัน |
| Void / คืนเงิน | เปิด lot ใหม่ที่ `avg_cost` ปัจจุบันของสินค้า (`fifoRefundLot`) ไม่ผูกกับใบเสร็จ |
| Adjust เพิ่ม | ลำดับการเลือกต้นทุน: `cost_per_unit` ที่ส่งมา → ต้นทุน lot ล่าสุด → `avg_cost` ของสินค้า |

`shop_products.avg_cost` บนร้าน FIFO เป็น**ค่าที่คำนวณมาเพื่อแสดงผล**:
`Σ(qty × cost) / Σ(qty)` จาก lot ที่เหลือ (`calcFifoAvgCost`)

### ⚠️ สองเครื่องคิดไม่ตรงกันที่ edge case หนึ่ง

| | เมื่อ `totalQty <= 0` หลังรับของ |
|---|---|
| `lib/fifo.ts:44` (POS, preview บน UI) | คืน **ค่าเฉลี่ยเดิม** |
| `balance_file_service.ts:87` `nextCostState` (Balance File, Stock Card) | คืน **ต้นทุนที่รับเข้ามา** |

เกิดได้เฉพาะตอนที่รับของแล้วสต็อกยังติดลบอยู่ · ถ้าจะต่อยอดควรรวมให้เหลือสูตรเดียว

---

## 4. วงจรชีวิตสินค้า

### 4.1 สร้าง — `POST /shops/:shopId/products`

Body (`shop_catalog.schema.ts` `createShopProduct`):

```jsonc
{
  "product_code": "string, 1–50, required",
  "name":         "string, 1–255, required",
  "external_price": 0,          // required, ≥ 0
  "barcode": null, "category": null,
  "internal_price": null,       // ≥ 0, default = external_price
  "vat_percent": null,          // 0–100, default 7.0
  "avg_cost": null,             // ≥ 0, default 0
  "stock": null,                // default 0 — ไม่มี minimum รับค่าติดลบได้
  "min_stock": null,            // ≥ 0, default 0
  "color": null, "uom_id": null
}
```

Service (`shop_product_service.ts:216`):

1. ร้านต้องมีอยู่จริง → ไม่งั้น **404**
2. `product_code` ต้องไม่ชนกับแถวที่ **active** ในร้านเดียวกัน → ไม่งั้น **409 "Product code already exists in this shop"**
3. เติม default: `internal_price ← external_price`, `vat_percent ← 7.0`, `category ← "ทั่วไป"`
4. Insert พร้อม `is_active = true`, `sort_order = 0`
5. **ถ้า `shop_type ≠ 'fifo'` และ `stock > 0`** เขียน movement type `receive` โดย `note = 'Initial stock'` และ `cost_per_unit = avg_cost`

> **ช่องโหว่ FIFO:** ร้าน FIFO ที่สร้างสินค้าพร้อมสต็อกตั้งต้น **จะไม่ได้ทั้ง
> movement และ lot** · `shop_products.stock` บอกว่ามี N แต่ `fifo_lots` ว่างเปล่า ·
> คอมเมนต์ในโค้ดเขียนว่า deferred

> **`avg_cost` รับได้ที่นี่ที่เดียว** ในกลุ่ม CRUD ของสินค้า — ดู §4.3

### 4.2 เพิ่มด้วยมือผ่าน import — ดู §6

### 4.3 แก้ไข — `PATCH /shops/:shopId/products/:productId`

แก้ได้: `product_code`, `barcode`, `name`, `category`, `external_price`,
`internal_price`, `vat_percent`, `min_stock`, `is_active`, `photo_url`,
`color`, `uom_id`, `short_name`, `sort_order`

**แก้ไม่ได้ — โดยเจตนา:**

- **`avg_cost`** — ถูกปฏิเสธตั้งแต่ระดับ schema พร้อมคอมเมนต์ลงวันที่ 2026-07 ว่า
  เปลี่ยนได้ผ่าน receive หรือ adjust เท่านั้น · เมื่อก่อน admin พิมพ์ตัวเลขในฟอร์มแก้ไข
  แล้วทับค่าเฉลี่ยจริงได้เงียบๆ
- **`stock`** — เหตุผลเดียวกัน ให้ใช้ receive หรือ adjust เพื่อให้มี movement เขียนไว้

กฎอื่น:

- คนที่ไม่ใช่ admin/manager ส่ง field นอกเหนือ `{color, sort_order, short_name}` → **403** พร้อมระบุ field ที่ผิด
- `uom_id: 0` แปลว่า "ล้างค่า" → NULL
- การเปลี่ยน `external_price` หรือ `internal_price` เขียน `audit_logs` (`entity_type='shop_product'`, action `UPDATE`) พร้อมค่าเก่า/ใหม่

### 4.4 ลบ — `DELETE /shops/:shopId/products/:productId`

**soft delete เท่านั้น** · ตั้ง `is_active = false` และเขียน `audit_logs` พร้อม snapshot
ของชื่อ ราคา สต็อก และหมวดหมู่ · movement, FIFO lot และประวัติการขายไม่ถูกแตะ

การ `DELETE` จริงถูกกันไว้โดย `receipt_items_product_variant_id_fkey` —
ต้องลบบรรทัดในใบเสร็จก่อน ซึ่งจะทำลายประวัติการขาย **อย่าทำ**

---

## 5. การเคลื่อนไหวสต็อก

### 5.1 รับของ — `POST /shops/:shopId/receive`

```jsonc
{ "items": [                       // minItems 1
  { "product_id": 0,               // required
    "qty": 0,                      // required, ≠ 0 (ติดลบ = คืนซัพพลายเออร์)
    "cost_per_unit": 0,            // required, ≥ 0
    "po": null, "invoice": null, "note": null,
    "received_date": "YYYY-MM-DD"  // optional
  } ] }
```

ต่อ 1 item ภายใน **transaction เดียวสำหรับทั้ง batch** (`shop_product_service.ts:431`):

1. `SELECT … FOR UPDATE` บนสินค้า **จำกัดด้วยร้าน** → ไม่เจอ **404**
2. `qty === 0` → **422 "qty cannot be 0"**
3. ร้าน `avg_cost`: `newStock = stockBefore + qty`, `newAvg = calcNewAvgCost(...)` ·
   ร้าน FIFO: `qty > 0` เพิ่ม lot, `qty < 0` ตัดจาก lot เก่าสุด
4. `UPDATE shop_products` — stock, avg_cost และ **`internal_price ← avg_cost` เมื่อค่าเฉลี่ยเปลี่ยนและร้านไม่ใช่ FIFO**
5. `INSERT shop_movements` type `receive`, `date = วันที่บันทึก`, `received_date = ค่าที่ normalise แล้วหรือวันนี้`, เขียนทั้ง `reference` (ของเก่า) และ `po_number`/`invoice_number`

`received_date` รับเฉพาะรูปแบบ `^\d{4}-\d{2}-\d{2}$` เท่านั้น อย่างอื่นตกกลับเป็นวันนี้
เงียบๆ (`normaliseReceivedDate`) · การย้อนวันที่ปลอดภัยโดยการออกแบบ เพราะไม่มีอะไร
คิดเงินหรือเรียงลำดับจากคอลัมน์นี้

> **ไม่มีการล็อกงวด** · รับของเข้าเดือนที่ปิดไปแล้วไม่ถูกบล็อก

### 5.2 ปรับสต็อก — `POST /shops/:shopId/adjust`

```jsonc
{ "product_id": 0, "delta": 0, "reason": "string, required, ห้ามว่าง",
  "cost_per_unit": null }
```

- `delta === 0` → **422 "delta cannot be 0"**
- สินค้าต้องอยู่ในร้านนั้น → ไม่งั้น **404**
- ร้าน `avg_cost`: สต็อกขยับตาม `delta` · **ค่าเฉลี่ยขยับเฉพาะเมื่อส่ง `cost_per_unit` มาด้วย** — ไม่ส่งก็ขยับแต่จำนวนโดยไม่แตะต้นทุน
- ร้าน FIFO: `fifoAdjustInTx` — ติดลบตัดจาก lot, เป็นบวกเปิด lot ใหม่
- เขียน `type = 'adjustment'` พร้อม `note = reason`

> **ความไม่สมมาตรที่สำคัญ:** adjustment ที่ระบุต้นทุนจะเปลี่ยน
> `shop_products.avg_cost` แต่ **Stock Card และ Balance File ไม่นับ** เพราะ
> `nextCostState` ขยับค่าเฉลี่ยเฉพาะ `receive` · ค่าที่เก็บกับค่าที่ replay
> จะแยกกันตั้งแต่จุดนั้นไป · **อะไรที่ตั้งใจให้เปลี่ยนต้นทุน ให้ใช้ receive**

### 5.3 ขาย — ผ่าน `POST /pos/checkout`

`pos_checkout_service.ts:604` · ต่อ 1 บรรทัด ภายใน transaction ของ checkout:

1. `SELECT … FOR UPDATE` บน `shop_products`
2. FIFO: `fifoDeductInTx` เขียนกลับทั้ง stock และค่าเฉลี่ยใหม่ · ไม่ใช่ FIFO: `stock = stockBefore − qty` ค่าเฉลี่ยไม่แตะ
3. `INSERT shop_movements` โดย `quantity = −qty`, `cost_per_unit = avg_cost ณ เวลาขาย`, `sale_amount = line_total`, `reference = receipt_number`

`transaction_mode = 'INTERNAL_ISSUE'` จะเขียน `type = 'internal_use'` แทน `'sale'`
(`pos_checkout_service.ts:475`) นอกนั้นเหมือนกันทุกอย่าง

**ไม่มีการเช็กว่าของพอขายไหม** · ขายจนสต็อกติดลบได้ ·
**ร้าน canteen หักสต็อกเหมือนร้าน store ทุกประการ** — flag `module` มีผลแค่กับ
daily limit และหน้าจอที่เปิดให้ใช้ ไม่เกี่ยวกับ ledger เลย

**Bundle** จะแตกเป็นส่วนประกอบ: แต่ละแถวใน `bundle_items` หัก
`component.quantity × จำนวน bundle` และเขียน movement ของตัวเอง ·
ตัว bundle ไม่มีแถวสต็อก

### 5.4 ยกเลิกใบเสร็จ — `POST /pos/receipts/:id/void`

`pos_service.ts:605` · ต่อบรรทัด: `stock_after = stock_before + quantity`,
เขียน movement `type = 'void'` ที่ `avg_cost` **ปัจจุบัน** และถ้าเป็น FIFO
เปิด refund lot ใหม่ · bundle คืนทีละส่วนประกอบ

### 5.5 เบิกใช้ภายใน — `POST /shops/:shopId/requisition`

`ShopController.ts:469` · เป็นตัวห่อบางๆ ที่สร้าง checkout แบบ
`transaction_mode = 'INTERNAL_ISSUE'`:

- ผู้เบิกต้องมีอยู่จริงและ **active** → ไม่งั้น **404 / 400**
- ทุกบรรทัดสินค้าต้องอยู่ในร้านนั้น → ไม่งั้น **404**
- `pay_mode: 'department'` ต้องมี `payer_department_id` → ไม่งั้น **422** · ใช้ได้ทุกร้าน (เงื่อนไข `shops.allow_department_charge` เดิมถูกถอดออกแล้ว)
- `pay_mode: 'free'` ตั้ง `price_override = 0`
- ราคาต่อหน่วย = `internal_price` ถ้ามี ไม่งั้น `external_price`

### 5.6 ปิดงวด — `/shops/:shopId/close-month/**`

`close_month_service.ts`

| ขั้น | Endpoint | พฤติกรรม |
|---|---|---|
| เปิดงวด | `POST /close-month` | snapshot **สินค้า active ทุกตัว**: `stock` → `system_qty`, `avg_cost` → `unit_cost` · `UNIQUE(shop_id, period_year, period_month)` → **409** ถ้าเปิดซ้ำ |
| นับของ | `PATCH /close-month/:id/items` หรือ `POST …/import-excel` | กรอก `physical_qty` |
| ยืนยัน | `POST /close-month/:id/confirm` | ดูด้านล่าง |

ตอนยืนยัน:

1. status เป็น `closed` อยู่แล้ว → **409**
2. มี item ที่ `physical_qty === null` → **422 "N item(s) still need physical count"**
3. ต่อ item: `variance = physical − system` · ผลต่างเป็น 0 ไม่เขียน movement
4. ผลต่างไม่เป็น 0 → เขียน movement `adjustment` โดย `note = "ปิดรอบ YYYY-MM"`, `UPDATE shop_products.stock` และผูก `adjustment_movement_id` กลับไปที่ close item
5. `variance_value = variance × unit_cost` — ใช้ต้นทุนที่ **แช่แข็งไว้ตอนเปิดงวด** ไม่ใช่ของวันนี้
6. status → `closed`, `closed_by`, `closed_at`

> การยืนยันปิดงวด **ไม่ได้ล็อกงวด** · การรับของ ขาย และปรับสต็อกที่ลงวันที่ใน
> เดือนที่ปิดแล้วยังทำได้ และจะเปลี่ยนตัวเลขรายงานของงวดนั้น

---

## 6. นำเข้าข้อมูลจำนวนมาก

`POST /admin/import/store` (ชีตเดียว ใช้อยู่ปัจจุบัน) และของเก่า
`/products` กับ `/stock-receive` · Role: `admin`, `manager` ·
`?dry_run=1` ตรวจและรายงานผลโดยไม่เขียนจริง

### 6.1 Template

`GET /admin/import/template?shop_id=…` คืนไฟล์ xlsx · คอลัมน์ของ store:

```
product_code | product_name | barcode | external_price | internal_price |
category | uom | shop_id | stock | cost_per_unit | notes | reference
```

ร้าน canteen ได้ template แบบ catalog อย่างเดียว — ไม่มี `stock` / `cost_per_unit` /
`notes` / `reference` เพราะ canteen ไม่ได้ติดตามสต็อกราย SKU บนหน้าจอ

ไฟล์ที่มีทั้งชีต `Products` **และ** `StockReceive` จะเข้าทางเก่าแบบสองชีต ·
นอกนั้นอ่านชีตแรก

### 6.2 การประมวลผลแต่ละแถว (`processCombinedRows`, `admin_import_service.ts:524`)

ประมวลผลแบบ **ขนานทีละ batch ละ 20 แถว** · แต่ละแถวถูกจำแนกเป็น:

- `hasProductData` = มี `name` **และ** `external_price` **และ** `internal_price` ครบ → upsert สินค้า
- `hasStockData` = มี `stock` **และ ≠ 0** → เข้าคิวเรียก `receiveStock()`

การ validate ต่อแถว (error ถูกเก็บรวมแล้วคืนกลับ ไม่ทำให้ import ทั้งไฟล์ล้ม):

| เงื่อนไข | ข้อความ |
|---|---|
| ไม่มี `product_name` | `ต้องระบุ 'name' (ชื่อสินค้า)` |
| `external_price` ไม่ใช่ตัวเลข | `'price' (ราคาขาย) ต้องเป็นตัวเลข` |
| `internal_price` ไม่ใช่ตัวเลข | `'cost_price' (ต้นทุน) ต้องเป็นตัวเลข` |
| ไม่รู้จัก `shop_id` | `ไม่พบร้าน '<id>' ในระบบ` |
| manager import ร้านอื่น | `Manager รับสต็อกได้เฉพาะร้านของตัวเองเท่านั้น` |
| แถวสต็อกที่หาสินค้าไม่เจอ | `ไม่พบสินค้าสำหรับรับสต็อก — ต้องระบุ product_id หรือ barcode ที่ถูกต้อง` |

สังเกตว่า **ชีตสต็อก clamp manager ให้อยู่ในร้านตัวเอง** แต่ endpoint
`POST /shops/:shopId/receive` ตรงๆ ไม่ clamp (§2)

### 6.3 กติกา upsert

ลำดับการจับคู่: `product_code` → ถ้าไม่มีใช้ `name` ภายในร้านนั้น

**สินค้าที่มีอยู่แล้ว** — อัปเดต `name`, `external_price`, `internal_price`,
`category`, และ `uom_id` / `product_code` ถ้าส่งมา · **ไม่แตะ `avg_cost` และ `stock` เด็ดขาด**

**สินค้าใหม่** — โค้ดคือ `product_code` ที่ส่งมา หรือสร้างเป็น
`IMP-<8 หลัก><hex>` · insert ด้วย `stock = 0`, `vat_percent = 0`,
`is_active = true` และ:

```ts
const openingCost = coerceNum(row.cost_per_unit) ?? costVal;   // :194
avgCost: String(openingCost),                                   // :292
```

`cost_per_unit` (คอลัมน์ต้นทุนตอนรับของ) ชนะ · `internal_price` เป็นตัวสำรอง
สำหรับแถวที่เป็น catalog อย่างเดียว

> **บรรทัดนี้เคยเป็น bug จนถึง 2026-08** · `avg_cost` ถูกฝังตายเป็น `"0.0000"`
> และเพราะ `hasStockData` ข้ามแถวที่ `stock = 0` จึงไม่มี `receiveStock()`
> ตัวไหนมาแก้ให้ · แถว catalog อย่างเดียวจึงลงเอยด้วยต้นทุน 0 ถาวร การขายครั้งแรก
> ถูกคิดต้นทุน ฿0 และสต็อกติดลบที่ต้นทุนศูนย์ · เนื่องจากแถวที่ `stock > 0`
> *จะ* เรียก `receiveStock()` ซึ่งคำนวณค่าเฉลี่ยจาก `stockBefore = 0`
> แล้วได้ `cost_per_unit` พอดี **สองเส้นทางจึงดูเหมือนกันตอนทดสอบแต่ต่างกันจริงบน
> production** · ถ้าพอร์ต importer นี้ไป อย่าลืมบรรทัดนี้
>
> ตัวแก้ฝั่งรายงานที่มาคู่กัน: `balance_file_service.ts:244` จะยืมค่า
> `shop_products.avg_cost` มาใช้เมื่อสินค้าไม่มีประวัติ movement ก่อนช่วงที่รายงาน
> เพื่อให้สินค้าที่ import มาแบบ stock 0 คิดต้นทุนถูกใน ledger ด้วย

แถวสต็อกจะเรียก `receiveStock()` ตัวเดียวกับ endpoint แบบ manual
movement, FIFO lot และค่าเฉลี่ยจึงออกมาเหมือนกันเป๊ะ

---

## 7. การอ่านและรายงาน

### 7.1 Endpoint

| Endpoint | คืนอะไร |
|---|---|
| `GET /shops/:shopId/products` | catalog + `stock`, `avg_cost` ปัจจุบัน, barcode เสริม, UoM, `has_options` |
| `GET /shops/low-stock` | สินค้าที่ `stock <= min_stock` |
| `GET /shops/:shopId/movements` | ledger ดิบ กรองได้ |
| `GET /shops/:shopId/products/:id/fifo-lots` | ชั้นต้นทุน FIFO ที่ยังเปิดอยู่ |
| `GET /shops/:shopId/monthly-stock-report` (+ `/export`) | รับ / ขาย / เบิกใช้ / ปรับ ต่อสินค้า |
| `GET /shops/:shopId/balance-file` (+ `/export`) | ledger ต้นทุนรายเดือนพร้อมค่าเฉลี่ยสะสม |
| `GET /reports/stock-card` | บัตรเดินสินค้าต่อสินค้า |
| `GET /reports/receive-stock` | บันทึกการรับของพร้อม PO / invoice |

### 7.2 รายงานสต็อกรายเดือน

`monthly_stock_service.ts:18` — ตัดช่วงด้วย `shop_movements.date`

```
received     = Σ quantity          where type = 'receive'
sold         = Σ quantity          where type = 'sale'
internal_use = Σ quantity          where type IN ('internal_use','exchange')
adjustment   = Σ (stock_after − stock_before) where type = 'adjustment'
net change   = received − sold − internal_use + adjustment
```

สังเกตว่า `adjustment` ใช้ผลต่างของสต็อก ส่วนตัวอื่นใช้ `quantity` —
นั่นคือกฎเครื่องหมายใน §1.5 ที่ใช้งานจริง

### 7.3 Stock Card กับ Balance File — ใช้แทนกันไม่ได้

ทั้งคู่ replay `shop_movements` ผ่าน `nextCostState()` **ตัวเดียวกัน**
(`balance_file_service.ts:78`) ซึ่ง Stock Card import ไปใช้ แต่ยังต่างกัน:

| | Stock Card | Balance File |
|---|---|---|
| กรองร้าน | ไม่กรอง — ใช้ `product_id` ล้วน | `shop_movements.shop_id` |
| ตัดช่วงเวลา | `created_at` | `date` |
| เรียงลำดับ | `created_at` | `date, created_at, id` |
| สินค้า | ตัวที่เลือก | ทุกตัวที่ `is_active = true` |
| คอลัมน์ต้นทุน | คอลัมน์เดียว: แถว receive สะท้อน **`cost_per_unit` ที่เก็บไว้** ส่วนแถวอื่นแสดงค่าเฉลี่ย *ก่อน* แถวนั้น | สามคอลัมน์: `in_unit_cost`, `out_avg_cost` และ **`bal_avg_cost` = ค่าเฉลี่ยสะสม *หลัง* แถวนั้น** |
| ยอดขาออก | **ฐานต้นทุน** (`qty × avg`) | **รายได้** (`sale_amount`) เมื่อมีค่า |
| ยอดยกมาเมื่อไม่มีประวัติก่อนหน้า | ยืมจาก `shop_products.avg_cost` | เหมือนกัน (เพิ่มเมื่อ 2026-08) |

ผลที่ตามมาที่ควรรู้ก่อนเอาสองรายงานมาเทียบกัน:

- แถว receive ใน Stock Card **แสดงค่าที่กรอกเสมอ** จึงใช้ยืนยันว่าค่าเฉลี่ยถูกไม่ได้ · ค่าที่คำนวณจริงดูได้จาก `bal_avg_cost` ของ Balance File ที่เดียว
- **ยอดขาออกเทียบกันไม่ได้** — ตัวหนึ่งเป็นต้นทุน อีกตัวเป็นรายได้ · เป็นเจตนา และมีคอมเมนต์ในโค้ดกำกับว่า "do not re-align them"
- คอลัมน์จำนวน และ Amount In เทียบกันได้

### 7.4 สูตร replay

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

ได้คุณสมบัติ 2 ข้อ และทั้งคู่สำคัญ:

- **มีแต่แถว receive ที่ขยับค่าเฉลี่ย** · แก้ `cost_per_unit` บนแถวขายไม่มีผลกับรายงานใดๆ
- **แถวที่ไม่ใช่ receive ตั้งจำนวนแบบสัมบูรณ์จาก `stock_after`** · การ replay จึงแก้ตัวเองได้เมื่อ ledger ขาดช่วง — แต่ก็แปลว่า **การสลับลำดับแถวเปลี่ยนผลลัพธ์** เพราะเฉลี่ยถ่วงน้ำหนักขึ้นกับลำดับ

---

## 8. Invariant และกฎ

**การันตี**

1. ทุกการเปลี่ยนแปลงสต็อกเขียน `shop_movements` 1 แถวพอดี ภายใน transaction เดียวกับที่อัปเดต `shop_products`
2. แถวใน `shop_products` ถูกล็อก `FOR UPDATE` ก่อนอ่าน-แก้-เขียนทุกครั้ง
3. `stock_before` / `stock_after` ต่อเนื่องกันต่อสินค้าเมื่อเรียงตาม `created_at`
4. movement ไม่เคยถูก update หรือ delete โดย application code — การแก้ไขคือการเขียนแถวใหม่
5. `avg_cost` เขียนได้ผ่าน receive, adjust, checkout, void และ close-month เท่านั้น

**อนุญาตโดยเจตนา**

- `stock` ติดลบ (ทั้งสองเครื่องคิดต้นทุน)
- receive ที่ quantity ติดลบ (คืนซัพพลายเออร์) ซึ่งจะถอนมูลค่าที่เคยเพิ่มไว้ออก
- ขายทั้งที่ไม่มีของ
- รับของเข้างวดที่ปิดไปแล้ว
- สินค้า inactive ยังมีสต็อกและประวัติ
- `product_code` ซ้ำกันได้ระหว่างแถวที่ inactive

**ไม่มีที่ไหนบังคับเลย**

- สิทธิ์ระดับร้านบน receive/adjust (§2)
- การเช็กว่าของพอขาย
- การล็อกงวดหลังปิด (§5.6)
- การแปลงหน่วย UoM — `conversion_factor` ไม่เคยถูกใช้
- FIFO lot สำหรับสินค้าที่สร้างพร้อมสต็อกตั้งต้น (§4.1)

---

## 9. การนำไปต่อยอด

ถ้าจะยกเครื่อง stock นี้ไปใช้ในโปรเจกต์อื่น:

1. **ยึด `shop_movements` เป็นของหลัก** · `shop_products.stock` และ `.avg_cost` เป็นแค่ cache ของ ledger ทุกรายงานสร้างใหม่จาก movement · การเก็บทั้งสองอย่างแปลว่าต้องทำให้กระทบยอดกันได้ตลอด — เขียนตัวตรวจที่ replay ledger แล้วเทียบไว้ด้วย
2. **ใช้ฟังก์ชันคิดต้นทุนตัวเดียว** · bug กลุ่มใหญ่ที่สุดใน codebase นี้คือ "ค่าเฉลี่ยต้นทุน" มีสอง implementation แล้วค่อยๆ แยกจากกัน: `lib/fifo.ts:36` (ค่าสด) กับ `balance_file_service.ts:78` (ค่าที่ replay) · ตอนนี้ยังไม่ตรงกันที่ edge case `totalQty <= 0`
3. **ตัดสินใจเรื่องสต็อกติดลบตั้งแต่ต้น** · จะอนุญาตก็ได้ แต่ทุกการคำนวณต้นทุนต้องเขียนโดยรู้ว่าพจน์จำนวนติดลบได้ และ UI ต้องอธิบายค่าเฉลี่ยที่ออกมาได้
4. **อย่าให้ UI ตั้งต้นทุนโดยไม่มี movement** · bug ตอน import ใน §6.3 กับความไม่สมมาตรของ adjustment ใน §5.2 คือความผิดพลาดแบบเดียวกันคนละที่: state เปลี่ยนแต่ ledger ไม่เปลี่ยน
5. **เติม clamp ระดับร้าน** บน write path ก่อนที่ระบบจะเป็น multi-tenant จริงๆ ไม่ใช่แค่ในชื่อ
