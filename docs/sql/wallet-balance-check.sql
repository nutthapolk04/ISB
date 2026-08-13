-- ============================================================================
-- "ตอนนี้ใครมีเงินในกระเป๋าบ้าง" แยกตามระดับชั้น / parents
--
-- นักเรียนถือกระเป๋าผ่าน customers (wallets.customer_id)
-- ผู้ปกครองถือผ่าน users        (wallets.user_id)
-- 1 คน = 1 กระเป๋า (ตรวจแล้วในฐาน ไม่มีใครมีหลายใบ)
--
-- แยก 4 ช่อง เพราะ "ไม่มีกระเป๋า" กับ "มีกระเป๋าแต่ยอด 0" ไม่เหมือนกัน
-- และยอดติดลบเกิดได้จริง (customers.negative_credit_limit อนุญาตให้ติดลบ)
--
-- อ่านอย่างเดียว ไม่แก้ข้อมูลใดๆ
-- ============================================================================

WITH people AS (
    -- นักเรียน
    SELECT
        c.id,
        CASE c.school_type
            WHEN 'ES Student' THEN '1. ES'
            WHEN 'MS Student' THEN '2. MS'
            WHEN 'HS Student' THEN '3. HS'
            ELSE '4. Student (ไม่ระบุระดับ)'
        END        AS bucket,
        'student'  AS kind,
        w.balance  AS balance          -- NULL = ไม่มีกระเป๋า
    FROM customers c
    LEFT JOIN wallets w ON w.customer_id = c.id
    WHERE c.customer_kind = 'student'
      -- AND c.is_active                 -- ← เอา comment ออก ถ้าจะนับเฉพาะที่ยัง active
      -- AND NOT c.is_graduated          -- ← เอา comment ออก ถ้าจะตัดคนที่จบไปแล้ว

    UNION ALL

    -- ผู้ปกครอง
    SELECT
        u.id,
        '6. Parents' AS bucket,
        'parent'     AS kind,
        w.balance
    FROM users u
    LEFT JOIN wallets w ON w.user_id = u.id
    WHERE u.role = 'parent'
      -- AND u.is_active                 -- ← เอา comment ออก ถ้าจะนับเฉพาะที่ยัง active
)
SELECT
    g.label                                                   AS "กลุ่ม",
    count(*)                                                  AS "ทั้งหมด",
    count(*) FILTER (WHERE p.balance >  0)                    AS "มีเงิน",
    count(*) FILTER (WHERE p.balance =  0)                    AS "ยอด 0",
    count(*) FILTER (WHERE p.balance <  0)                    AS "ติดลบ",
    count(*) FILTER (WHERE p.balance IS NULL)                 AS "ไม่มีกระเป๋า",
    round(100.0 * count(*) FILTER (WHERE p.balance > 0)
          / nullif(count(*), 0), 1)                           AS "% มีเงิน",
    COALESCE(sum(p.balance) FILTER (WHERE p.balance > 0), 0)  AS "ยอดรวมที่มีเงิน"
FROM people p
JOIN LATERAL (VALUES
    ('1. ES',                       p.bucket = '1. ES'),
    ('2. MS',                       p.bucket = '2. MS'),
    ('3. HS',                       p.bucket = '3. HS'),
    ('4. Student (ไม่ระบุระดับ)',      p.bucket = '4. Student (ไม่ระบุระดับ)'),
    -- "All students" = MS + HS เท่านั้น ตามที่ตกลง — ES ไม่รวม
    ('5. All students (MS+HS)',     p.bucket IN ('2. MS', '3. HS')),
    ('6. Parents',                  p.kind   = 'parent')
) g(label, member) ON g.member
GROUP BY g.label
ORDER BY g.label;

-- ── หมายเหตุ ────────────────────────────────────────────────────────────────
-- 1) แถว "5. All students (MS+HS)" ตั้งใจไม่รวม ES และไม่รวมคนที่ไม่ระบุระดับ
--    เพราะฉะนั้น ES (แถว 1) กับ ไม่ระบุระดับ (แถว 4) จะอยู่นอกยอดรวมนี้
--    ถ้าวันไหนอยากให้รวมทุกคนจริงๆ เปลี่ยนบรรทัดนั้นเป็น
--        ('5. All students', p.kind = 'student'),
--
-- 2) ค่า school_type ในฐานเป็น 'ES Student' / 'MS Student' / 'HS Student'
--    ถ้า prod สะกดต่างจากนี้ CASE ข้างบนจะเทไปกอง "ไม่ระบุระดับ" หมด
--    เช็กก่อนด้วย:  SELECT school_type, count(*) FROM customers GROUP BY 1;
--
-- 3) ตัวกรอง is_active / is_graduated ปิดไว้เป็นค่าเริ่มต้น เพราะบางชุดข้อมูล
--    ตั้ง is_active=false ไว้เกือบทั้งหมด ถ้าเปิดโดยไม่ดูก่อน ตัวเลขจะหายเป็นกอง
--    เช็กก่อนด้วย:  SELECT is_active, is_graduated, count(*) FROM customers GROUP BY 1,2;
--
-- 4) อยากได้รายชื่อ ไม่ใช่แค่ตัวเลข ให้เปลี่ยน SELECT ท่อนท้ายเป็น
--        SELECT c.external_id, c.name, c.school_type, w.balance
--        FROM customers c LEFT JOIN wallets w ON w.customer_id = c.id
--        WHERE c.customer_kind = 'student' AND COALESCE(w.balance, 0) = 0
--        ORDER BY c.school_type, c.name;
