-- ============================================================================
-- Thai demo seed — inserts 15 Thai-language records into (almost) every table.
-- Runs as ONE transaction; any error rolls the whole thing back.
--
-- Skipped on purpose:
--   * customer_types   — enum has only PUBLIC/INTERNAL (max 2 rows, already full)
--   * alembic_version  — migration bookkeeping, must not be touched
--
-- All seeded rows are tagged with a "T"/"ทดสอบ" prefix so they can be removed.
-- Cleanup helper at the very bottom (commented out).
--
-- Run:  docker exec -i isb-postgres psql -U user -d ISB -v ON_ERROR_STOP=1 < scripts/seed_thai_demo.sql
-- ============================================================================

BEGIN;

-- ── Tier 0: no FK dependencies ──────────────────────────────────────────────

INSERT INTO spending_groups (code, name_en, name_th, daily_limit, is_active)
SELECT 'SG-T'||lpad(g::text,2,'0'), 'Demo Group '||g,
  (ARRAY['กลุ่มอนุบาล','กลุ่มประถมต้น','กลุ่มประถมปลาย','กลุ่มมัธยมต้น','กลุ่มมัธยมปลาย','กลุ่มครู','กลุ่มพนักงาน','กลุ่มผู้บริหาร','กลุ่มแม่บ้าน','กลุ่มรปภ.','กลุ่มโรงอาหาร','กลุ่มร้านค้า','กลุ่มกิจกรรม','กลุ่มวีไอพี','กลุ่มทั่วไป'])[g],
  50 + g*10, true
FROM generate_series(1,15) g;

INSERT INTO categories (name, description, is_active)
SELECT (ARRAY['เครื่องเขียน','อุปกรณ์การเรียน','หนังสือเรียน','ของเล่นเสริมพัฒนาการ','เครื่องดื่ม','ขนมขบเคี้ยว','อาหารสด','ชุดนักเรียน','อุปกรณ์กีฬา','อุปกรณ์ศิลปะ','เครื่องใช้ไฟฟ้า','กระเป๋านักเรียน','รองเท้านักเรียน','ของใช้ส่วนตัว','สินค้าเบ็ดเตล็ด'])[g]||' (ทดสอบ)',
  'หมวดหมู่ทดสอบภาษาไทย '||g, true
FROM generate_series(1,15) g;

INSERT INTO roles (name, description, is_active)
SELECT 'role_t'||lpad(g::text,2,'0'),
  (ARRAY['ผู้ดูแลระบบ','ผู้จัดการ','แคชเชียร์','พนักงานครัว','ผู้ปกครอง','นักเรียน','ครู','ธุรการ','คลังสินค้า','ผู้ตรวจสอบ','พนักงานขาย','หัวหน้าแผนก','ผู้ช่วย','ผู้สังเกตการณ์','แขก'])[g]||' (ทดสอบ)', true
FROM generate_series(1,15) g;

INSERT INTO permissions (name, resource, action, description)
SELECT 'perm_t'||lpad(g::text,2,'0'),
  (ARRAY['receipts','products','users','wallets','reports','inventory','shops','customers','departments','settings','roles','audit','sync','payments','refunds'])[g],
  (ARRAY['create','read','update','delete','approve'])[1+((g-1)%5)], 'สิทธิ์ทดสอบ '||g
FROM generate_series(1,15) g;

INSERT INTO departments (department_code, department_name, annual_budget, current_year, is_active)
SELECT 'DEPT-T'||lpad(g::text,2,'0'),
  (ARRAY['ฝ่ายวิชาการ','ฝ่ายปกครอง','ฝ่ายธุรการ','ฝ่ายอาคารสถานที่','ฝ่ายกิจการนักเรียน','ฝ่ายการเงิน','ฝ่ายบุคคล','ฝ่ายเทคโนโลยี','ฝ่ายห้องสมุด','ฝ่ายพยาบาล','ฝ่ายกีฬา','ฝ่ายดนตรี','ฝ่ายศิลปะ','ฝ่ายภาษา','ฝ่ายวิทยาศาสตร์'])[g]||' (ทดสอบ)',
  100000 + g*5000, 2026, true
FROM generate_series(1,15) g;

INSERT INTO family_profiles (family_code)
SELECT 'FAM-T'||lpad(g::text,3,'0')
FROM generate_series(1,15) g;

INSERT INTO units_of_measure (code, name, name_en, conversion_factor, is_active)
SELECT 'UOM-T'||lpad(g::text,2,'0'),
  (ARRAY['ชิ้น','กล่อง','แพ็ค','โหล','กิโลกรัม','กรัม','ลิตร','มิลลิลิตร','ขวด','ถุง','แผ่น','ม้วน','ด้าม','เล่ม','คู่'])[g],
  (ARRAY['piece','box','pack','dozen','kg','g','liter','ml','bottle','bag','sheet','roll','stick','book','pair'])[g], 1, true
FROM generate_series(1,15) g;

INSERT INTO system_settings (key, value)
SELECT 'demo.setting.'||lpad(g::text,2,'0'), 'ค่าทดสอบ '||g
FROM generate_series(1,15) g;

-- ── Tier 1 ──────────────────────────────────────────────────────────────────

INSERT INTO shops (id, name, shop_type, description, is_active, module)
SELECT 'shop-t'||lpad(g::text,2,'0'),
  (ARRAY['ร้านค้าสวัสดิการ','โรงอาหารกลาง','ร้านเครื่องเขียน','ร้านหนังสือ','โรงอาหารอนุบาล','ร้านกาแฟ','ร้านขนม','ร้านชุดนักเรียน','ร้านกีฬา','ร้านศิลปะ','ร้านสะดวกซื้อ','โรงอาหารมัธยม','ร้านของที่ระลึก','ร้านไอที','ร้านทั่วไป'])[g]||' (ทดสอบ)',
  (ARRAY['avg_cost','fifo'])[1+((g-1)%2)]::shoptype, 'ร้านทดสอบ '||g, true,
  (ARRAY['store','canteen'])[1+((g-1)%2)]
FROM generate_series(1,15) g;

INSERT INTO users (username, email, full_name, hashed_password, is_active, is_superuser, role, status)
SELECT 'tuser'||lpad(g::text,2,'0'), 'tuser'||lpad(g::text,2,'0')||'@demo.local',
  (ARRAY['สมชาย','สมหญิง','วิชัย','มานี','ปิติ','ชูใจ','อนงค์','ประเสริฐ','กมล','นภา','ธนา','ศิริพร','วีระ','สุดา','อรุณ'])[g]
    ||' '||(ARRAY['ใจดี','รักเรียน','มั่งมี','ศรีสุข','พงษ์ไทย','สุขสันต์','วงศ์ใหญ่','แก้วมณี','ทองคำ','บุญมา','จันทร์เพ็ญ','ภักดี','รุ่งเรือง','พิทักษ์','เจริญสุข'])[g],
  '$2b$12$demoDEMOdemoDEMOdemoDEMOu', true, false,
  (ARRAY['cashier','manager','kitchen','admin','parent'])[1+((g-1)%5)], 'active'
FROM generate_series(1,15) g;

INSERT INTO products (name, description, category_id, brand, is_active)
SELECT (ARRAY['สมุดโน้ต','ดินสอ 2B','ปากกาลูกลื่น','ยางลบ','ไม้บรรทัด','กบเหลาดินสอ','สีไม้ 12 สี','กระเป๋านักเรียน','กรรไกร','กาวแท่ง','สมุดวาดเขียน','ดินน้ำมัน','พู่กัน','กล่องดินสอ','คลิปหนีบกระดาษ'])[g]||' (ทดสอบ)',
  'สินค้าทดสอบภาษาไทย '||g,
  (SELECT id FROM categories ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)), 'แบรนด์ทดสอบ', true
FROM generate_series(1,15) g;

-- ── Tier 2 ──────────────────────────────────────────────────────────────────

INSERT INTO customers (customer_code, name, customer_type_id, is_active, student_code, grade,
                       card_uid, card_frozen, customer_kind, school_type, family_code)
SELECT 'CUST-T'||lpad(g::text,2,'0'),
  (ARRAY['เด็กชายสมหวัง','เด็กหญิงพิมพ์','เด็กชายตะวัน','เด็กหญิงดาว','เด็กชายภูมิ','เด็กหญิงใบเฟิร์น','เด็กชายกล้า','เด็กหญิงแพรว','เด็กชายข้าว','เด็กหญิงน้ำ','เด็กชายฟ้า','เด็กหญิงมุก','เด็กชายเพชร','เด็กหญิงพลอย','เด็กชายโชค'])[g]||' ทดสอบ'||g,
  (SELECT id FROM customer_types ORDER BY id LIMIT 1 OFFSET ((g-1)%2)), true,
  'STD-T'||lpad(g::text,3,'0'),
  (ARRAY['อ.1','อ.2','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3','ม.4','ม.5','ม.6','อ.3'])[g],
  'CARD-T'||lpad(g::text,3,'0'), false, 'student',
  (ARRAY['ES Student','MS Student','HS Student'])[1+((g-1)%3)], 'FAM-T'||lpad(g::text,3,'0')
FROM generate_series(1,15) g;

INSERT INTO product_variants (product_id, sku, variant_name, color, size, barcode, cost_price, retail_price, is_active)
SELECT (SELECT id FROM products ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  'SKU-T'||lpad(g::text,3,'0'), 'รุ่นทดสอบ '||g,
  (ARRAY['แดง','น้ำเงิน','เขียว','เหลือง','ดำ'])[1+((g-1)%5)],
  (ARRAY['S','M','L','เล็ก','ใหญ่'])[1+((g-1)%5)],
  'BAR-T'||lpad(g::text,6,'0'), 10+g, 20+g*2, true
FROM generate_series(1,15) g;

INSERT INTO shop_categories (id, shop_id, name)
SELECT 'sc-t'||lpad(g::text,2,'0'),
  (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  (ARRAY['เครื่องดื่ม','ขนม','อาหารจานเดียว','ของหวาน','เครื่องเขียน','หนังสือ','อุปกรณ์','ชุดนักเรียน','กีฬา','ศิลปะ','ไอที','ของใช้','กระเป๋า','รองเท้า','อื่นๆ'])[g]
FROM generate_series(1,15) g;

INSERT INTO shop_products (shop_id, product_code, barcode, name, category, external_price, internal_price,
                          vat_percent, avg_cost, stock, min_stock, is_active, uom_id, short_name)
SELECT (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  'SP-T'||lpad(g::text,3,'0'), 'SPB-T'||lpad(g::text,6,'0'),
  (ARRAY['ข้าวผัดหมู','ก๋วยเตี๋ยวต้มยำ','ข้าวมันไก่','ผัดกะเพราไก่','ข้าวหมูแดง','ส้มตำไทย','ไก่ทอด','ข้าวไข่เจียว','ผัดซีอิ๊ว','ต้มยำกุ้ง','ข้าวกะเพราไข่ดาว','ราดหน้าหมู','ข้าวขาหมู','โจ๊กหมู','นมเย็น'])[g]||' (ทดสอบ)',
  (ARRAY['อาหาร','เครื่องดื่ม','ของหวาน'])[1+((g-1)%3)], 35+g, 30+g, 7, 20+g, 50+g, 10, true,
  (SELECT id FROM units_of_measure ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)), 'ย่อ'||g
FROM generate_series(1,15) g;

INSERT INTO product_bundles (shop_id, bundle_code, name, description, external_price, internal_price, sort_order, is_active)
SELECT (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  'BND-T'||lpad(g::text,3,'0'), 'ชุดเซ็ตทดสอบ '||g, 'ชุดสินค้าทดสอบภาษาไทย', 100+g, 90+g, g, true
FROM generate_series(1,15) g;

INSERT INTO price_panels (shop_id, name, color, sort_order)
SELECT (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  'แผงราคา '||g, (ARRAY['แดง','เขียว','น้ำเงิน'])[1+((g-1)%3)], g
FROM generate_series(1,15) g;

INSERT INTO product_order_history (shop_id, version, sort_map, source)
SELECT (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  g, '{}'::json, 'ทดสอบ'
FROM generate_series(1,15) g;

INSERT INTO fifo_lots (id, product_id, shop_id, date, qty_remaining, cost_per_unit)
SELECT 'lot-t'||lpad(g::text,3,'0'),
  (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  CURRENT_DATE - g, 10+g, 12+g
FROM generate_series(1,15) g;

INSERT INTO sync_logs (sync_type, target_roles, status, records_total, records_success, records_failed)
SELECT (ARRAY['students','staff','parents'])[1+((g-1)%3)], '["all"]'::jsonb, 'success', 10+g, 10+g, 0
FROM generate_series(1,15) g;

INSERT INTO audit_logs (entity_type, entity_id, action, user_id, ip_address, entity_name)
SELECT (ARRAY['customer','user','product','receipt','wallet'])[1+((g-1)%5)], g,
  (ARRAY['CREATE','UPDATE','DELETE','VOID','APPROVE'])[1+((g-1)%5)]::auditaction,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)), '127.0.0.1', 'รายการทดสอบ '||g
FROM generate_series(1,15) g;

INSERT INTO approval_requests (request_type, requested_by, status, amount, reason)
SELECT (ARRAY['DISCOUNT','VOID','RETURN','PRICE_OVERRIDE','BUDGET_OVERRIDE'])[1+((g-1)%5)]::approvalrequesttype,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)), 'PENDING'::approvalstatus, g*10, 'เหตุผลทดสอบ '||g
FROM generate_series(1,15) g;

INSERT INTO identity_mappings (entity_type, entity_id, old_external_id, new_external_id, reason, changed_by)
SELECT (ARRAY['customer','user'])[1+((g-1)%2)], g, 'OLD'||g, 'NEW'||g, 'แก้ไขรหัสทดสอบ '||g,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO budget_transactions (department_id, amount, transaction_type, description, balance_before, balance_after, created_by)
SELECT (SELECT id FROM departments ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  g*100, (ARRAY['ALLOCATION','DEDUCTION','ADJUSTMENT'])[1+((g-1)%3)]::budgettransactiontype,
  'รายการงบประมาณทดสอบ '||g, 10000, 10000-g*100,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO customer_display_images (data, content_type, filename, size_bytes, sort_order, uploaded_by)
SELECT decode('00010203','hex'), 'image/png', 'img-t'||g||'.png', 4, g,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM generate_series(1,15) g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM users ORDER BY id DESC LIMIT 15) s) u ON u.rn = g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM roles ORDER BY id DESC LIMIT 15) s) r ON r.rn = g;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM generate_series(1,15) g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM roles ORDER BY id DESC LIMIT 15) s) r ON r.rn = g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM permissions ORDER BY id DESC LIMIT 15) s) p ON p.rn = g;

INSERT INTO stock_period_closes (shop_id, period_year, period_month, status, closed_by)
SELECT (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  2026, g, 'draft', (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

-- ── Tier 3 ──────────────────────────────────────────────────────────────────

INSERT INTO wallets (customer_id, balance, is_active)
SELECT c.id, g*100, true
FROM generate_series(1,15) g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM customers ORDER BY id DESC LIMIT 15) s) c ON c.rn = g;

INSERT INTO barcodes (barcode, product_variant_id)
SELECT 'PVBAR-T'||lpad(g::text,6,'0'),
  (SELECT id FROM product_variants ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO stock_levels (product_variant_id, quantity, low_stock_threshold, location, updated_by)
SELECT pv.id, 100+g, 10, 'คลังทดสอบ',
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM product_variants ORDER BY id DESC LIMIT 15) s) pv ON pv.rn = g;

INSERT INTO inventory_transactions (transaction_type, product_variant_id, quantity_change, reason, created_by)
SELECT (ARRAY['SALE','RETURN','ADJUSTMENT','INITIAL','INTERNAL_ISSUE'])[1+((g-1)%5)]::transactiontype,
  (SELECT id FROM product_variants ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)), (g%2)*2*g-g, 'รายการสต๊อกทดสอบ '||g,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO stock_movements (product_variant_id, quantity_before, quantity_change, quantity_after, movement_type, notes, created_by)
SELECT (SELECT id FROM product_variants ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)), 100, g, 100+g,
  (ARRAY['SALE','RETURN','ADJUSTMENT','INITIAL','INTERNAL_ISSUE'])[1+((g-1)%5)]::transactiontype, 'บันทึกสต๊อกทดสอบ '||g,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO parent_child_links (parent_user_id, child_customer_id, relation, parent_rank)
SELECT u.id, c.id, (ARRAY['parent','guardian','grandparent'])[1+((g-1)%3)], 'P'||g
FROM generate_series(1,15) g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM users ORDER BY id DESC LIMIT 15) s) u ON u.rn = g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM customers ORDER BY id DESC LIMIT 15) s) c ON c.rn = g;

INSERT INTO menu_option_groups (product_id, name, selection_type, is_required, max_selections, sort_order)
SELECT (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  (ARRAY['ระดับความเผ็ด','ขนาด','ท็อปปิ้ง','เครื่องดื่ม','ความหวาน'])[1+((g-1)%5)]||' '||g,
  (ARRAY['single','multi','quantity'])[1+((g-1)%3)]::optionselectiontype, (g%2=0), 3, g
FROM generate_series(1,15) g;

INSERT INTO shop_movements (date, product_id, product_name, shop_id, type, quantity, stock_before, stock_after, note, created_by)
SELECT CURRENT_DATE - g,
  (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  'สินค้าร้านทดสอบ '||g,
  (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  (ARRAY['receive','sale','adjustment','internal_use','void'])[1+((g-1)%5)]::movementtype, g, 100, 100-g, 'หมายเหตุทดสอบ '||g,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO product_barcodes (product_id, barcode, label)
SELECT (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  'SPBAR-T'||lpad(g::text,6,'0'), 'บาร์โค้ดทดสอบ '||g
FROM generate_series(1,15) g;

INSERT INTO bundle_items (bundle_id, product_id, quantity, sort_order)
SELECT (SELECT id FROM product_bundles ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)), 1+(g%3), g
FROM generate_series(1,15) g;

INSERT INTO price_panel_items (panel_id, product_id, price, included, short_name)
SELECT pp.id, sp.id, 25+g, true, 'ย่อ'||g
FROM generate_series(1,15) g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM price_panels ORDER BY id DESC LIMIT 15) s) pp ON pp.rn = g
JOIN (SELECT id, row_number() OVER (ORDER BY id) rn FROM (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%' ORDER BY id DESC LIMIT 15) s) sp ON sp.rn = g;

INSERT INTO email_alerts_log (alert_type, recipient_email, parent_user_id, child_customer_id, subject, threshold_amount, balance_at_alert, status)
SELECT 'low_balance', 'parent'||g||'@demo.local',
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  (SELECT id FROM customers ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  'แจ้งเตือนยอดเงินคงเหลือต่ำ รายการ '||g, 50, g*5, 'sent'
FROM generate_series(1,15) g;

INSERT INTO receipts (receipt_number, transaction_mode, customer_id, shop_id, subtotal, discount, tax, total, payment_method, status, created_by)
SELECT 'RCPT-T'||lpad(g::text,4,'0'), 'SALE'::transactionmode,
  (SELECT id FROM customers ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  (SELECT id FROM shops WHERE id LIKE 'shop-t%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)),
  g*50, 0, g*3, g*53,
  (ARRAY['CASH','WALLET','QR_PROMPTPAY','EDC','DEPARTMENT'])[1+((g-1)%5)]::paymentmethod, 'ACTIVE'::receiptstatus,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO credit_notes (credit_note_number, original_receipt_id, total_credit_amount, refund_type, status, reason, created_by)
SELECT 'CN-T'||lpad(g::text,4,'0'),
  (SELECT id FROM receipts ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  g*20, (ARRAY['PRODUCT','WALLET','CASH'])[1+((g-1)%3)]::refundtype, 'PENDING'::creditnotestatus, 'ใบลดหนี้ทดสอบ '||g,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO stock_period_close_items (close_id, product_id, system_qty, physical_qty, variance_qty)
SELECT (SELECT id FROM stock_period_closes ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)), 100+g, 100+g-1, -1
FROM generate_series(1,15) g;

-- ── Tier 4 ──────────────────────────────────────────────────────────────────

INSERT INTO wallet_transactions (wallet_id, transaction_type, amount, balance_before, balance_after, description, created_by)
SELECT (SELECT id FROM wallets ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  (ARRAY['TOPUP','DEDUCTION','REFUND','ADJUSTMENT'])[1+((g-1)%4)]::wallettransactiontype, g*10, 100, 100+g*10, 'ธุรกรรมกระเป๋าเงินทดสอบ '||g,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO receipt_items (receipt_id, product_variant_id, quantity, unit_price, discount, line_total)
SELECT (SELECT id FROM receipts ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%' ORDER BY id LIMIT 1 OFFSET ((g-1)%15)), 1+(g%3), 25+g, 0, (25+g)*(1+(g%3))
FROM generate_series(1,15) g;

INSERT INTO menu_options (option_group_id, name, price_delta, sort_order)
SELECT (SELECT id FROM menu_option_groups ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  (ARRAY['เผ็ดน้อย','เผ็ดกลาง','เผ็ดมาก','พิเศษ','ธรรมดา'])[1+((g-1)%5)]||' '||g, (g%3)*5, g
FROM generate_series(1,15) g;

INSERT INTO payment_intents (ref_code, wallet_id, amount, status, payment_method, intent_type, created_by)
SELECT 'PI-T'||lpad(g::text,4,'0'),
  (SELECT id FROM wallets ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  g*20, (ARRAY['pending','confirmed','cancelled'])[1+((g-1)%3)]::paymentintentstatus,
  (ARRAY['qr_promptpay','wallet','cash'])[1+((g-1)%3)], 'wallet_topup',
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO return_requests (receipt_id, product_code, product_name, quantity, return_quantity, price, reason, status, created_by)
SELECT 'RCPT-T'||lpad(g::text,4,'0'), 'SP-T'||lpad(g::text,3,'0'), 'สินค้าคืนทดสอบ '||g, 2, 1, g*10, 'เหตุผลคืนสินค้าทดสอบ '||g,
  (ARRAY['pending','approved','rejected'])[1+((g-1)%3)]::returnstatus,
  (SELECT id FROM users ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15))
FROM generate_series(1,15) g;

INSERT INTO sync_audit_logs (sync_log_id, entity_type, entity_id, entity_name, external_id, action)
SELECT (SELECT id FROM sync_logs ORDER BY id DESC LIMIT 1 OFFSET ((g-1)%15)),
  (ARRAY['customer','user','parent'])[1+((g-1)%3)], g, 'รายการซิงก์ทดสอบ '||g, 'EXT-T'||g,
  (ARRAY['created','updated','skipped'])[1+((g-1)%3)]
FROM generate_series(1,15) g;

COMMIT;

-- ============================================================================
-- CLEANUP (run manually to remove all seeded demo rows):
--
-- BEGIN;
--   DELETE FROM sync_audit_logs WHERE external_id LIKE 'EXT-T%';
--   DELETE FROM return_requests WHERE receipt_id LIKE 'RCPT-T%';
--   DELETE FROM payment_intents WHERE ref_code LIKE 'PI-T%';
--   DELETE FROM menu_options WHERE option_group_id IN (SELECT id FROM menu_option_groups WHERE product_id IN (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%'));
--   DELETE FROM receipt_items WHERE receipt_id IN (SELECT id FROM receipts WHERE receipt_number LIKE 'RCPT-T%');
--   DELETE FROM wallet_transactions WHERE description LIKE 'ธุรกรรมกระเป๋าเงินทดสอบ%';
--   DELETE FROM stock_period_close_items WHERE close_id IN (SELECT id FROM stock_period_closes WHERE shop_id LIKE 'shop-t%');
--   DELETE FROM credit_notes WHERE credit_note_number LIKE 'CN-T%';
--   DELETE FROM receipts WHERE receipt_number LIKE 'RCPT-T%';
--   DELETE FROM email_alerts_log WHERE recipient_email LIKE 'parent%@demo.local';
--   DELETE FROM price_panel_items WHERE short_name LIKE 'ย่อ%' AND panel_id IN (SELECT id FROM price_panels WHERE shop_id LIKE 'shop-t%');
--   DELETE FROM bundle_items WHERE bundle_id IN (SELECT id FROM product_bundles WHERE bundle_code LIKE 'BND-T%');
--   DELETE FROM product_barcodes WHERE barcode LIKE 'SPBAR-T%';
--   DELETE FROM shop_movements WHERE shop_id LIKE 'shop-t%';
--   DELETE FROM menu_option_groups WHERE product_id IN (SELECT id FROM shop_products WHERE product_code LIKE 'SP-T%');
--   DELETE FROM parent_child_links WHERE parent_rank LIKE 'P%' AND parent_user_id IN (SELECT id FROM users WHERE username LIKE 'tuser%');
--   DELETE FROM stock_movements WHERE notes LIKE 'บันทึกสต๊อกทดสอบ%';
--   DELETE FROM inventory_transactions WHERE reason LIKE 'รายการสต๊อกทดสอบ%';
--   DELETE FROM stock_levels WHERE location = 'คลังทดสอบ';
--   DELETE FROM barcodes WHERE barcode LIKE 'PVBAR-T%';
--   DELETE FROM wallets WHERE customer_id IN (SELECT id FROM customers WHERE customer_code LIKE 'CUST-T%');
--   DELETE FROM stock_period_closes WHERE shop_id LIKE 'shop-t%';
--   DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE name LIKE 'role_t%');
--   DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'tuser%');
--   DELETE FROM customer_display_images WHERE filename LIKE 'img-t%';
--   DELETE FROM budget_transactions WHERE description LIKE 'รายการงบประมาณทดสอบ%';
--   DELETE FROM identity_mappings WHERE reason LIKE 'แก้ไขรหัสทดสอบ%';
--   DELETE FROM approval_requests WHERE reason LIKE 'เหตุผลทดสอบ%';
--   DELETE FROM audit_logs WHERE entity_name LIKE 'รายการทดสอบ%';
--   DELETE FROM sync_audit_logs WHERE sync_log_id IN (SELECT id FROM sync_logs WHERE status='success' AND records_failed=0);  -- careful
--   DELETE FROM fifo_lots WHERE id LIKE 'lot-t%';
--   DELETE FROM product_order_history WHERE shop_id LIKE 'shop-t%';
--   DELETE FROM price_panels WHERE shop_id LIKE 'shop-t%';
--   DELETE FROM product_bundles WHERE bundle_code LIKE 'BND-T%';
--   DELETE FROM shop_products WHERE product_code LIKE 'SP-T%';
--   DELETE FROM shop_categories WHERE id LIKE 'sc-t%';
--   DELETE FROM product_variants WHERE sku LIKE 'SKU-T%';
--   DELETE FROM customers WHERE customer_code LIKE 'CUST-T%';
--   DELETE FROM products WHERE name LIKE '%(ทดสอบ)';
--   DELETE FROM users WHERE username LIKE 'tuser%';
--   DELETE FROM shops WHERE id LIKE 'shop-t%';
--   DELETE FROM sync_logs WHERE id IN (SELECT id FROM sync_logs ORDER BY id DESC LIMIT 15);  -- careful
--   DELETE FROM system_settings WHERE key LIKE 'demo.setting.%';
--   DELETE FROM units_of_measure WHERE code LIKE 'UOM-T%';
--   DELETE FROM family_profiles WHERE family_code LIKE 'FAM-T%';
--   DELETE FROM departments WHERE department_code LIKE 'DEPT-T%';
--   DELETE FROM permissions WHERE name LIKE 'perm_t%';
--   DELETE FROM roles WHERE name LIKE 'role_t%';
--   DELETE FROM categories WHERE name LIKE '%(ทดสอบ)';
--   DELETE FROM spending_groups WHERE code LIKE 'SG-T%';
-- COMMIT;
-- ============================================================================
