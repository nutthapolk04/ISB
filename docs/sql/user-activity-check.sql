-- ============================================================================
-- "ใครเคยใช้งานระบบแล้วบ้าง" แยกตาม role
--
-- นิยาม "ใช้งาน" = ลงมือทำเอง เท่านั้น
--   นักเรียน      : แตะบัตรซื้อของ / แตะบัตรที่คีออส
--   staff, parent : ซื้อของเอง, เป็นคนขาย, เติมเงิน/โอนเอง, มี action ใน audit_logs
--   ไม่นับ        : การถูกคนอื่นเติมเงินให้ (ดูหมายเหตุท้ายไฟล์ ถ้าอยากนับด้วย)
--
-- นักเรียนอยู่ 2 ตาราง (users.role='student' และ customers) เชื่อมด้วย external_id
-- คนที่ไม่มี external_id จะจับคู่ไม่ได้ → รายงานเป็น "ระบุไม่ได้" ไม่เหมาไปเป็น "ไม่เคย"
--
-- อ่านอย่างเดียว ไม่แก้ข้อมูลใดๆ
-- ============================================================================

WITH user_acts AS (          -- ร่องรอยที่ผูกกับ users.id
    SELECT payer_user_id AS uid FROM receipts WHERE payer_user_id IS NOT NULL
    UNION SELECT created_by      FROM receipts
    UNION SELECT created_by      FROM wallet_transactions
    UNION SELECT acting_user_id  FROM wallet_transactions WHERE acting_user_id IS NOT NULL
    UNION SELECT created_by      FROM payment_intents
    UNION SELECT acting_user_id  FROM payment_intents     WHERE acting_user_id IS NOT NULL
    UNION SELECT user_id         FROM audit_logs
),
cust_acts AS (               -- ร่องรอยที่ผูกกับ customers.id (นักเรียนแตะบัตร)
    SELECT customer_id AS cid    FROM receipts          WHERE customer_id IS NOT NULL
    UNION SELECT acting_customer_id FROM wallet_transactions WHERE acting_customer_id IS NOT NULL
    UNION SELECT acting_customer_id FROM payment_intents     WHERE acting_customer_id IS NOT NULL
),
people AS (
    SELECT
        u.id,
        u.role,
        CASE
            WHEN u.role = 'student' THEN
                CASE
                    WHEN u.external_id IS NULL THEN NULL     -- จับคู่ customer ไม่ได้
                    ELSE EXISTS (
                        SELECT 1 FROM customers c
                        JOIN cust_acts a ON a.cid = c.id
                        WHERE c.external_id = u.external_id
                    )
                END
            ELSE (u.id IN (SELECT uid FROM user_acts))
        END AS used
    FROM users u
)
SELECT
    g.label                                                          AS "กลุ่ม",
    count(*)                                                         AS "ทั้งหมด",
    count(*) FILTER (WHERE p.used)                                   AS "เคยใช้งาน",
    count(*) FILTER (WHERE p.used IS FALSE)                          AS "ไม่เคย",
    count(*) FILTER (WHERE p.used IS NULL)                           AS "ระบุไม่ได้",
    round(100.0 * count(*) FILTER (WHERE p.used) / nullif(count(*), 0), 1) AS "%"
FROM people p
JOIN LATERAL (VALUES
    ('1. Staff',                      p.role = 'staff'),
    ('2. Students',                   p.role = 'student'),
    ('3. Parents',                    p.role = 'parent'),
    ('4. All (staff+student+parent)', p.role IN ('staff','student','parent')),
    ('5. All (ยกเว้น kiosk, admin)',   p.role NOT IN ('kiosk','admin'))
) g(label, member) ON g.member
GROUP BY g.label
ORDER BY g.label;

-- ── หมายเหตุ ────────────────────────────────────────────────────────────────
-- 1) อยากได้แยกทีละ role (รวม manager/cashier/admin/kiosk) ให้เปลี่ยนท่อนท้าย
--    ตั้งแต่ SELECT เป็น:
--        SELECT role, count(*), count(*) FILTER (WHERE used),
--               count(*) FILTER (WHERE used IS FALSE),
--               count(*) FILTER (WHERE used IS NULL)
--        FROM people GROUP BY role ORDER BY role;
--
-- 2) อยากนับ "ถูกคนอื่นเติมเงินให้" เป็นการใช้งานด้วย ให้เพิ่มบรรทัดนี้ใน cust_acts:
--        UNION SELECT w.customer_id FROM wallet_transactions wt
--              JOIN wallets w ON w.id = wt.wallet_id WHERE w.customer_id IS NOT NULL
--
-- 3) อยากจำกัดช่วงวันที่ ("เคยใช้ในเทอมนี้") ให้ใส่เงื่อนไขเวลาในทุก subquery
--    ของ user_acts / cust_acts เช่น
--        WHERE transaction_date >= '2026-05-01T00:00:00+07:00'
--    (ตารางต่างกันใช้คนละคอลัมน์: receipts=transaction_date,
--     wallet_transactions/payment_intents/audit_logs=created_at)
