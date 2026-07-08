BEGIN;

UPDATE shop_products SET vat_percent = 0.00;

-- Verify
SELECT COUNT(*) AS total, MIN(vat_percent::numeric) AS min_vat, MAX(vat_percent::numeric) AS max_vat FROM shop_products;

COMMIT;
