BEGIN;

-- Step 1: Insert new shop rows (S001 → S0001, N001 → N0001)
INSERT INTO shops (id, name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number)
SELECT 'S0001', name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number
FROM shops WHERE id = 'S001';

INSERT INTO shops (id, name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number)
SELECT 'S0002', name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number
FROM shops WHERE id = 'S002';

INSERT INTO shops (id, name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number)
SELECT 'S0003', name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number
FROM shops WHERE id = 'S003';

INSERT INTO shops (id, name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number)
SELECT 'S0004', name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number
FROM shops WHERE id = 'S004';

INSERT INTO shops (id, name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number)
SELECT 'N0001', name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number
FROM shops WHERE id = 'N001';

INSERT INTO shops (id, name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number)
SELECT 'N0002', name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number
FROM shops WHERE id = 'N002';

INSERT INTO shops (id, name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number)
SELECT 'N0003', name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number
FROM shops WHERE id = 'N003';

INSERT INTO shops (id, name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number)
SELECT 'N0004', name, shop_type, description, is_active, allow_department_charge,
  module, uses_dual_pricing, products_order_version, created_at, updated_at,
  spending_group_id, receipt_header, receipt_footer, void_shortcuts, shop_number
FROM shops WHERE id = 'N004';

-- Step 2: Move FK references (insert '0' after first char: S001 → S0001)
UPDATE users               SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE shop_categories     SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE receipts            SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE shop_movements      SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE product_order_history SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE fifo_lots           SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE product_bundles     SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE price_panels        SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE shop_products       SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');
UPDATE stock_period_closes SET shop_id = LEFT(shop_id,1) || '0' || SUBSTRING(shop_id,2) WHERE shop_id IN ('S001','S002','S003','S004','N001','N002','N003','N004');

-- Step 3: Delete old rows
DELETE FROM shops WHERE id IN ('S001','S002','S003','S004','N001','N002','N003','N004');

-- Verify
SELECT id, name FROM shops ORDER BY id;

COMMIT;
