-- ============================================================================
-- ตรวจ avg cost ของ Stock Card ทีละแถว — หาว่าเพี้ยนตั้งแต่ตรงไหน
--
-- สำคัญ: avg cost ใน Stock Card Report **ไม่ได้เก็บไว้ในฐาน**
--         รายงานคำนวณใหม่ทุกครั้งที่เปิด โดยไล่ movement ตั้งแต่แถวแรก
--         (balance_file_service.ts :: nextCostState)
--
--   type = 'receive'  → avg ใหม่ = (จำนวนเดิม × avg เดิม + จำนวนรับ × cost_per_unit)
--                                  ÷ จำนวนรวม
--   type อื่นทั้งหมด    → avg **ไม่เปลี่ยน** (ขายของไม่ทำให้ต้นทุนเปลี่ยน)
--
-- แปลว่า ถ้า avg ผิด ต้นเหตุอยู่ที่ cost_per_unit หรือ quantity
-- ของ **แถว receive** เท่านั้น — แถว sale/adjustment แก้ไปก็ไม่มีผลกับรายงาน
--
-- อ่านอย่างเดียว ไม่แก้ข้อมูลใดๆ
-- ============================================================================

\set product_code '01200025'

-- ── 1. สินค้าตัวนี้คือใคร และ avg_cost ที่เก็บอยู่ตอนนี้เท่าไหร่ ───────────────
SELECT id, shop_id, product_code, name, stock, avg_cost, internal_price, updated_at
FROM shop_products
WHERE product_code = :'product_code';

-- ── 2. ไล่ประวัติทีละแถว พร้อมคำนวณ avg ซ้ำแบบเดียวกับรายงาน ─────────────────
WITH RECURSIVE ordered AS (
    SELECT m.*, row_number() OVER (ORDER BY m.created_at, m.id) AS rn
    FROM shop_movements m
    JOIN shop_products p ON p.id = m.product_id
    WHERE p.product_code = :'product_code'
),
replay AS (
    SELECT
        o.rn, o.id, o.created_at, o.date, o.type, o.quantity,
        o.stock_before, o.stock_after, o.cost_per_unit, o.reference, o.note,
        CASE WHEN o.type = 'receive' AND (0 + o.quantity) > 0
             THEN COALESCE(o.cost_per_unit, 0)::numeric
             ELSE 0::numeric END                             AS avg_after,
        (CASE WHEN o.type = 'receive' THEN 0 + o.quantity ELSE o.stock_after END) AS qty_after
    FROM ordered o WHERE o.rn = 1

    UNION ALL

    SELECT
        o.rn, o.id, o.created_at, o.date, o.type, o.quantity,
        o.stock_before, o.stock_after, o.cost_per_unit, o.reference, o.note,
        CASE WHEN o.type = 'receive' THEN
                CASE WHEN r.qty_after + o.quantity > 0
                     THEN (r.qty_after * r.avg_after + o.quantity * COALESCE(o.cost_per_unit, 0))
                          / (r.qty_after + o.quantity)
                     ELSE COALESCE(o.cost_per_unit, 0)::numeric END
             ELSE r.avg_after END                            AS avg_after,
        CASE WHEN o.type = 'receive' THEN r.qty_after + o.quantity
             ELSE o.stock_after END                          AS qty_after
    FROM ordered o
    JOIN replay r ON o.rn = r.rn + 1
)
SELECT
    rn                              AS "#",
    created_at::timestamptz(0)      AS "บันทึกเมื่อ",
    date                            AS "วันที่",
    type                            AS "ประเภท",
    quantity                        AS "จำนวน",
    stock_before                    AS "คงเหลือก่อน",
    stock_after                     AS "คงเหลือหลัง",
    cost_per_unit                   AS "cost/unit ในฐาน",
    round(avg_after, 4)             AS "avg ที่รายงานจะแสดง",
    qty_after                       AS "qty ที่รายงานไล่ได้",
    CASE WHEN type = 'receive' THEN '← แถวนี้เท่านั้นที่ขยับ avg' ELSE '' END AS "หมายเหตุ",
    reference, note
FROM replay
ORDER BY rn;

-- ── 3. เทียบค่าสุดท้ายที่ไล่ได้ กับค่าที่เก็บใน shop_products ─────────────────
-- ถ้าสองค่านี้ไม่ตรงกัน แปลว่า avg_cost ถูกเขียนทับจากทางอื่น
-- (เช่น การปรับสต็อกพร้อมระบุต้นทุน ซึ่งเปลี่ยน shop_products.avg_cost
--  แต่ Stock Card ไม่นับ เพราะ type='adjustment' ไม่ขยับ avg)
WITH RECURSIVE ordered AS (
    SELECT m.*, row_number() OVER (ORDER BY m.created_at, m.id) AS rn
    FROM shop_movements m JOIN shop_products p ON p.id = m.product_id
    WHERE p.product_code = :'product_code'
),
replay AS (
    SELECT o.rn,
        CASE WHEN o.type='receive' AND (0+o.quantity)>0 THEN COALESCE(o.cost_per_unit,0)::numeric ELSE 0::numeric END AS avg_after,
        (CASE WHEN o.type='receive' THEN 0+o.quantity ELSE o.stock_after END) AS qty_after
    FROM ordered o WHERE o.rn = 1
    UNION ALL
    SELECT o.rn,
        CASE WHEN o.type='receive' THEN
            CASE WHEN r.qty_after + o.quantity > 0
                 THEN (r.qty_after*r.avg_after + o.quantity*COALESCE(o.cost_per_unit,0))/(r.qty_after+o.quantity)
                 ELSE COALESCE(o.cost_per_unit,0)::numeric END
        ELSE r.avg_after END,
        CASE WHEN o.type='receive' THEN r.qty_after + o.quantity ELSE o.stock_after END
    FROM ordered o JOIN replay r ON o.rn = r.rn + 1
)
SELECT
    p.product_code,
    p.avg_cost                                   AS "avg_cost ที่เก็บไว้",
    round((SELECT avg_after FROM replay ORDER BY rn DESC LIMIT 1), 4) AS "avg ที่ Stock Card ไล่ได้",
    p.stock                                      AS "stock ที่เก็บไว้",
    (SELECT qty_after FROM replay ORDER BY rn DESC LIMIT 1)           AS "qty ที่ Stock Card ไล่ได้",
    CASE WHEN p.avg_cost = round((SELECT avg_after FROM replay ORDER BY rn DESC LIMIT 1), 4)
         THEN 'ตรงกัน' ELSE '*** ไม่ตรงกัน ***' END AS "ผล"
FROM shop_products p
WHERE p.product_code = :'product_code';
