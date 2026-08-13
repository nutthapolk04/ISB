-- ============================================================================
-- ทำไม Stock Card ถูกแล้ว แต่ Balance File ยังเป็นค่าเดิม
--
-- ทั้งสองรายงานคำนวณ avg cost ด้วยสูตรเดียวกัน (nextCostState) และอ่านจาก
-- shop_movements เหมือนกัน — ไม่มีที่ไหนอ่าน shop_products.avg_cost เลย
-- เพราะฉะนั้นถ้าผลต่างกัน แปลว่า "หยิบแถวมาไม่เหมือนกัน" ไม่ใช่คำนวณต่างกัน
--
--                    Stock Card                  Balance File
--   กรองร้าน          ไม่กรอง (product_id ล้วน)     shop_movements.shop_id = ร้านที่เลือก
--   ตัดช่วงเวลา        created_at                   date
--   เรียงลำดับ         created_at                   date, created_at, id
--   รายการสินค้า       ตัวที่เลือก                    เฉพาะ is_active = true
--
-- ไฟล์นี้ไล่ 4 จุดนั้นทีละข้อ  — อ่านอย่างเดียว ไม่แก้ข้อมูล
-- ============================================================================

\set product_code '01200025'

-- ── 1. product_code นี้มีกี่แถว และ active ไหม ──────────────────────────────
-- Balance File แสดงเฉพาะ is_active = true
-- ถ้ามีหลายแถว (โค้ดซ้ำ) อาจแก้ไปคนละ id กับที่รายงานแสดง
SELECT id, shop_id, product_code, name, is_active, stock, avg_cost, updated_at
FROM shop_products
WHERE product_code = :'product_code'
ORDER BY id;

-- ── 2. shop_id บนแถว movement ตรงกับร้านของสินค้าไหม ────────────────────────
-- Balance File กรอง shop_movements.shop_id ด้วย — ถ้าไม่ตรง แถวจะถูกทิ้งทั้งแถว
-- และ Stock Card จะยังเห็น (เพราะไม่กรองร้าน) → นี่คือสาเหตุที่พบบ่อยที่สุด
SELECT
    m.shop_id                        AS "shop_id บน movement",
    p.shop_id                        AS "shop_id ของสินค้า",
    (m.shop_id IS NOT DISTINCT FROM p.shop_id) AS "ตรงกัน",
    count(*)                         AS "จำนวนแถว",
    count(*) FILTER (WHERE m.type = 'receive') AS "แถว receive"
FROM shop_movements m
JOIN shop_products p ON p.id = m.product_id
WHERE p.product_code = :'product_code'
GROUP BY 1, 2, 3
ORDER BY 3, 1;

-- ── 3. date กับ created_at ตรงวันกันไหม ────────────────────────────────────
-- Balance File ตัดเดือนด้วย `date`  แต่ Stock Card ใช้ `created_at`
-- แถวที่สองค่านี้คนละวัน จะไปโผล่คนละเดือนในสองรายงาน
SELECT
    m.id, m.type, m.quantity, m.cost_per_unit,
    m.date                                   AS "date (Balance File ใช้)",
    m.created_at::timestamptz(0)             AS "created_at (Stock Card ใช้)",
    (m.date <> (m.created_at AT TIME ZONE 'Asia/Bangkok')::date) AS "คนละวัน",
    m.shop_id, m.note
FROM shop_movements m
JOIN shop_products p ON p.id = m.product_id
WHERE p.product_code = :'product_code'
ORDER BY m.created_at, m.id;

-- ── 4. เรียงตาม date กับตาม created_at ได้ลำดับเดียวกันไหม ──────────────────
-- avg เฉลี่ยถ่วงน้ำหนัก "ขึ้นกับลำดับ" — สลับลำดับแถว receive แล้วได้คนละค่า
-- ถ้าคอลัมน์สุดท้ายมี false แปลว่าสองรายงานไล่คนละลำดับ ผลจึงต่างกันได้
--   (แถวที่ไม่ใช่ receive ไม่กระทบ avg — ดูเฉพาะ receive พอ)
WITH m AS (
    SELECT m.*,
        row_number() OVER (ORDER BY m.date, m.created_at, m.id) AS ลำดับ_balance_file,
        row_number() OVER (ORDER BY m.created_at, m.id)         AS ลำดับ_stock_card
    FROM shop_movements m
    JOIN shop_products p ON p.id = m.product_id
    WHERE p.product_code = :'product_code'
)
SELECT id, type, quantity, cost_per_unit, date, created_at::timestamptz(0),
       ลำดับ_balance_file, ลำดับ_stock_card,
       (ลำดับ_balance_file = ลำดับ_stock_card) AS "ลำดับตรงกัน"
FROM m
WHERE type = 'receive'
ORDER BY ลำดับ_stock_card;
