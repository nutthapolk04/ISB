#!/bin/bash
set -e

# Wait for Postgres to be reachable (Railway's private networking can hiccup during redeploy).
# Fail fast with 5s connect timeout per attempt, up to 60s total.
echo "=== Waiting for Postgres ==="
python -c "
import sys, time
from sqlalchemy import create_engine, text
from app.core.config import settings

for attempt in range(1, 13):
    try:
        eng = create_engine(settings.DATABASE_URL, connect_args={'connect_timeout': 5})
        with eng.connect() as conn:
            conn.execute(text('SELECT 1'))
        print(f'  ✓ Postgres reachable on attempt {attempt}')
        sys.exit(0)
    except Exception as e:
        print(f'  attempt {attempt}/12 failed: {type(e).__name__}', file=sys.stderr)
        if attempt == 12:
            print('  !!! Postgres still unreachable after 60s — giving up', file=sys.stderr)
            sys.exit(1)
        time.sleep(5)
" || { echo '!!! Cannot reach Postgres — aborting boot' >&2; exit 1; }

# Skip alembic entirely — project uses raw SQL schema patches below (see AGENTS.md).
# Kept historical migration for record but not executed at boot.

# Bootstrap base tables on fresh DB (idempotent — no-op if tables exist).
# Schema patches below assume base tables already exist.
echo "=== Ensuring base tables ==="
python -c "
from app.core.database import Base, engine
import app.main  # noqa: F401  — transitively imports every model so metadata is complete
Base.metadata.create_all(bind=engine)
print('  ✓ base tables ensured')
" || { echo '!!! Base table creation failed' >&2; exit 1; }

# === Pre-patch: critical columns that must exist before seed runs ===
# Run these in their own python call so a failure in the main block never blocks them.
python -c "
from sqlalchemy import text
from app.core.database import engine
with engine.begin() as conn:
    conn.execute(text('ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token VARCHAR(64)'))
print('  + users.session_token (pre-patch)')
" 2>/dev/null || echo "  = users.session_token (pre-patch skipped — ok)"

python -c "
from sqlalchemy import text
from app.core.database import engine
with engine.begin() as conn:
    conn.execute(text('ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_type VARCHAR(30)'))
    conn.execute(text('ALTER TABLE users ADD COLUMN IF NOT EXISTS ps_department VARCHAR(100)'))
print('  + users.staff_type, users.ps_department (pre-patch)')
" 2>/dev/null || echo "  = users.staff_type/ps_department (pre-patch skipped — ok)"

echo "=== Applying schema patches ==="
python -c "
import sys
from sqlalchemy import text
from app.core.database import engine

def run(sql, label, ok_if_exists=True):
    # Each statement runs in its own transaction so one failure doesn't
    # abort the rest (Postgres aborts the whole tx on any error).
    try:
        with engine.begin() as conn:
            conn.execute(text(sql))
        print(f'  + {label}')
    except Exception as e:
        msg = str(e).lower()
        if ok_if_exists and ('already exists' in msg or 'duplicate column' in msg):
            print(f'  = {label} (already applied)')
        else:
            print(f'  ! {label} FAILED: {e}', file=sys.stderr)

# === Phase 1: role column on users ===
run(\"ALTER TABLE users ADD COLUMN role VARCHAR(20) DEFAULT 'cashier'\", 'users.role')
run(\"UPDATE users SET role = 'admin' WHERE is_superuser = true AND (role IS NULL OR role = 'cashier')\", 'users.role backfill admin', ok_if_exists=False)
run(\"UPDATE users SET role = 'manager' WHERE username LIKE 'manager_%' AND (role IS NULL OR role = 'cashier')\", 'users.role backfill manager', ok_if_exists=False)
run(\"UPDATE users SET role = 'parent' WHERE username LIKE 'parent_%' AND (role IS NULL OR role = 'cashier')\", 'users.role backfill parent', ok_if_exists=False)

# === Phase 2: student fields on customers ===
run('ALTER TABLE customers ADD COLUMN student_code VARCHAR(20) UNIQUE', 'customers.student_code')
run('ALTER TABLE customers ADD COLUMN grade VARCHAR(20)', 'customers.grade')
run('ALTER TABLE customers ADD COLUMN allergies TEXT', 'customers.allergies')
run('ALTER TABLE customers ADD COLUMN dietary_notes TEXT', 'customers.dietary_notes')
run('ALTER TABLE customers ADD COLUMN card_uid VARCHAR(50) UNIQUE', 'customers.card_uid')
run('ALTER TABLE customers ADD COLUMN card_frozen BOOLEAN DEFAULT false NOT NULL', 'customers.card_frozen')
run('ALTER TABLE customers ADD COLUMN daily_limit NUMERIC(10,2)', 'customers.daily_limit')
run('ALTER TABLE customers ADD COLUMN powerschool_sync_at TIMESTAMPTZ', 'customers.powerschool_sync_at')

# === Phase 3: admin controls (negative credit limit, allergy override, shop on receipt) ===
run('ALTER TABLE customers ADD COLUMN negative_credit_limit NUMERIC(10,2)', 'customers.negative_credit_limit')
run('ALTER TABLE customers ADD COLUMN allergy_override_note TEXT', 'customers.allergy_override_note')
run('ALTER TABLE receipts ADD COLUMN shop_id VARCHAR(50) REFERENCES shops(id)', 'receipts.shop_id')
run('CREATE INDEX IF NOT EXISTS ix_receipts_shop ON receipts(shop_id)', 'receipts idx shop')

# === Phase 3.5: User Management Module (PowerSchool integrated) ===
# users: external_id, family_code, photo_url, status, last_synced_at, allergies
run(\"ALTER TABLE users ADD COLUMN external_id VARCHAR(50)\", 'users.external_id')
run('CREATE UNIQUE INDEX IF NOT EXISTS ix_users_external_id ON users(external_id) WHERE external_id IS NOT NULL', 'users idx external_id')
run(\"ALTER TABLE users ADD COLUMN family_code VARCHAR(20)\", 'users.family_code')
run('CREATE INDEX IF NOT EXISTS ix_users_family_code ON users(family_code)', 'users idx family_code')
run('ALTER TABLE users ADD COLUMN photo_url TEXT', 'users.photo_url')
run(\"ALTER TABLE users ADD COLUMN status VARCHAR(20) DEFAULT 'active' NOT NULL\", 'users.status')
run('ALTER TABLE users ADD COLUMN last_synced_at TIMESTAMPTZ', 'users.last_synced_at')
run('ALTER TABLE users ADD COLUMN allergies TEXT', 'users.allergies')
# customers: family_code + external_id
run(\"ALTER TABLE customers ADD COLUMN family_code VARCHAR(20)\", 'customers.family_code')
run('CREATE INDEX IF NOT EXISTS ix_customers_family_code ON customers(family_code)', 'customers idx family_code')
run(\"ALTER TABLE customers ADD COLUMN external_id VARCHAR(50)\", 'customers.external_id')
run('CREATE UNIQUE INDEX IF NOT EXISTS ix_customers_external_id ON customers(external_id) WHERE external_id IS NOT NULL', 'customers idx external_id')

# identity_mappings: history of external_id changes
run('''
    CREATE TABLE IF NOT EXISTS identity_mappings (
        id SERIAL PRIMARY KEY,
        entity_type VARCHAR(20) NOT NULL,
        entity_id INTEGER NOT NULL,
        old_external_id VARCHAR(50),
        new_external_id VARCHAR(50),
        reason VARCHAR(200),
        changed_by INTEGER REFERENCES users(id),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
''', 'identity_mappings table')
run('CREATE INDEX IF NOT EXISTS ix_identity_mappings_entity ON identity_mappings(entity_type, entity_id)', 'identity_mappings idx entity')

# sync_logs: PowerSchool sync audit
run('''
    CREATE TABLE IF NOT EXISTS sync_logs (
        id SERIAL PRIMARY KEY,
        sync_type VARCHAR(20) NOT NULL,
        target_roles JSONB NOT NULL,
        triggered_by INTEGER REFERENCES users(id),
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at TIMESTAMPTZ,
        status VARCHAR(20) NOT NULL DEFAULT 'running',
        records_total INTEGER DEFAULT 0,
        records_success INTEGER DEFAULT 0,
        records_failed INTEGER DEFAULT 0,
        error_log TEXT
    )
''', 'sync_logs table')
run('CREATE INDEX IF NOT EXISTS ix_sync_logs_started ON sync_logs(started_at DESC)', 'sync_logs idx started')

# === Phase 3.5b: PowerSchool payload alignment ===
# users: card_uid (RFID hex) + customer_type (PS enum: Staff/Parent)
run('ALTER TABLE users ADD COLUMN card_uid VARCHAR(50)', 'users.card_uid')
run('CREATE UNIQUE INDEX IF NOT EXISTS ix_users_card_uid ON users(card_uid) WHERE card_uid IS NOT NULL', 'users idx card_uid')
run(\"ALTER TABLE users ADD COLUMN customer_type VARCHAR(20)\", 'users.customer_type')
# customers: customer_type (PS enum) + school_type (ES/MS/HS Student)
run(\"ALTER TABLE customers ADD COLUMN customer_type VARCHAR(20)\", 'customers.customer_type_ps')
run(\"ALTER TABLE customers ADD COLUMN school_type VARCHAR(20)\", 'customers.school_type')
# parent_child_links: parent_rank (main/secondary)
run(\"ALTER TABLE parent_child_links ADD COLUMN parent_rank VARCHAR(10)\", 'parent_child_links.parent_rank')

# family_profiles: notification emails + login ids per family_code
run('''
    CREATE TABLE IF NOT EXISTS family_profiles (
        family_code VARCHAR(20) PRIMARY KEY,
        notification_emails JSONB NOT NULL DEFAULT '[]'::jsonb,
        login_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        last_synced_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
''', 'family_profiles table')

# === P1: shop_products.photo_url for menu images (canteen + coop) ===
run('ALTER TABLE shop_products ADD COLUMN photo_url VARCHAR(500)', 'shop_products.photo_url')

# === P2.2: department charge (coop + all canteens) ===
run('ALTER TABLE shops ADD COLUMN allow_department_charge BOOLEAN NOT NULL DEFAULT false',
    'shops.allow_department_charge')
# Backfill all shops that should allow department charges.
run(\"UPDATE shops SET allow_department_charge = true WHERE id IN ('coop','canteen','canteen_thai','canteen_drinks')\",
    'shops allow_department_charge backfill', ok_if_exists=False)

# === P2.2b: user→department FK for card-tap auto-fill ===
run('ALTER TABLE users ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL',
    'users.department_id')

# === P2.3: EDC audit fields on receipts ===
run('ALTER TABLE receipts ADD COLUMN edc_terminal_ref VARCHAR(50)', 'receipts.edc_terminal_ref')
run('ALTER TABLE receipts ADD COLUMN edc_approval_code VARCHAR(20)', 'receipts.edc_approval_code')
run('ALTER TABLE receipts ADD COLUMN edc_masked_card VARCHAR(30)', 'receipts.edc_masked_card')

# === P4: Shop functional module (canteen vs store) ===
run(\"ALTER TABLE shops ADD COLUMN module VARCHAR(20) NOT NULL DEFAULT 'store'\",
    'shops.module')
run(\"UPDATE shops SET module = 'canteen' WHERE id IN ('canteen', 'canteen_thai', 'canteen_drinks')\",
    'shops.module backfill canteen', ok_if_exists=False)

# === P1: payment method enum extensions (CARD_TAP, EDC, DEPARTMENT) ===
# Postgres ALTER TYPE ADD VALUE cannot run inside a transaction block → use AUTOCOMMIT.
# SQLAlchemy's SQLEnum stores enum NAMES (uppercase), so we add uppercase values.
def add_enum_value(enum_type, value):
    try:
        with engine.connect().execution_options(isolation_level='AUTOCOMMIT') as conn:
            conn.execute(text(f\"ALTER TYPE {enum_type} ADD VALUE IF NOT EXISTS '{value}'\"))
        print(f'  + {enum_type} += {value}')
    except Exception as e:
        print(f'  ! {enum_type} += {value} FAILED: {e}', file=sys.stderr)

for v in ('CARD_TAP', 'EDC', 'DEPARTMENT'):
    add_enum_value('paymentmethod', v)

# === P5: Canteen menu options (per-product customisations) ===
# optionselectiontype enum: single (radio) / multi (checkbox) / quantity (+/- counter)
def create_enum(type_name, values):
    try:
        with engine.connect().execution_options(isolation_level='AUTOCOMMIT') as conn:
            vals = ', '.join(f\"'{v}'\" for v in values)
            conn.execute(text(f'CREATE TYPE {type_name} AS ENUM ({vals})'))
        print(f'  + enum {type_name}')
    except Exception as e:
        msg = str(e).lower()
        if 'already exists' in msg:
            print(f'  = enum {type_name} (already applied)')
        else:
            print(f'  ! enum {type_name} FAILED: {e}', file=sys.stderr)

create_enum('optionselectiontype', ['single', 'multi', 'quantity'])

run('''
    CREATE TABLE IF NOT EXISTS menu_option_groups (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        selection_type optionselectiontype NOT NULL,
        is_required BOOLEAN NOT NULL DEFAULT false,
        max_selections INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
''', 'menu_option_groups table')
run('CREATE INDEX IF NOT EXISTS ix_menu_option_groups_product ON menu_option_groups(product_id)',
    'menu_option_groups idx product')

run('''
    CREATE TABLE IF NOT EXISTS menu_options (
        id SERIAL PRIMARY KEY,
        option_group_id INTEGER NOT NULL REFERENCES menu_option_groups(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        price_delta NUMERIC(10,2) NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
    )
''', 'menu_options table')
run('CREATE INDEX IF NOT EXISTS ix_menu_options_group ON menu_options(option_group_id)',
    'menu_options idx group')

# receipt_items.options — JSONB snapshot of chosen menu options at checkout time
run('ALTER TABLE receipt_items ADD COLUMN options JSONB', 'receipt_items.options')

# === Phase 2: parent_child_links ===
run('''
    CREATE TABLE IF NOT EXISTS parent_child_links (
        id SERIAL PRIMARY KEY,
        parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        child_customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        relation VARCHAR(20) NOT NULL DEFAULT 'guardian',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_parent_child UNIQUE(parent_user_id, child_customer_id)
    )
''', 'parent_child_links table')
run('CREATE INDEX IF NOT EXISTS ix_parent_child_parent ON parent_child_links(parent_user_id)', 'parent_child_links idx parent')
run('CREATE INDEX IF NOT EXISTS ix_parent_child_child ON parent_child_links(child_customer_id)', 'parent_child_links idx child')

# === Phase 2: payment_intents ===
run('''
    CREATE TABLE IF NOT EXISTS payment_intents (
        id SERIAL PRIMARY KEY,
        ref_code VARCHAR(50) UNIQUE NOT NULL,
        wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
        amount NUMERIC(10,2) NOT NULL,
        qr_payload TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        confirmed_at TIMESTAMPTZ,
        confirmed_by INTEGER REFERENCES users(id),
        notes VARCHAR(500)
    )
''', 'payment_intents table')
run('CREATE INDEX IF NOT EXISTS ix_payment_intents_wallet ON payment_intents(wallet_id)', 'payment_intents idx wallet')
run('CREATE INDEX IF NOT EXISTS ix_payment_intents_ref ON payment_intents(ref_code)', 'payment_intents idx ref')

# === Feature 1: payment_intents payment method tagging ===
run('ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) DEFAULT \'qr_promptpay\'',
    'payment_intents.payment_method')
run('ALTER TABLE payment_intents ADD COLUMN IF NOT EXISTS confirmed_via VARCHAR(30)',
    'payment_intents.confirmed_via')

# === Feature 2: audit_logs table ===
run('''
    CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INTEGER,
        entity_name VARCHAR(255),
        shop_id VARCHAR(50),
        action VARCHAR(30) NOT NULL,
        changes_json JSONB,
        user_id INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
''', 'audit_logs table')
# Backfill columns added after initial table creation
run('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS shop_id VARCHAR(50)',
    'audit_logs.shop_id')
run('ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS entity_name VARCHAR(255)',
    'audit_logs.entity_name')
run('CREATE INDEX IF NOT EXISTS ix_audit_logs_entity ON audit_logs(entity_type, entity_id)',
    'audit_logs idx entity')
run('CREATE INDEX IF NOT EXISTS ix_audit_logs_shop ON audit_logs(shop_id)',
    'audit_logs idx shop')
run('CREATE INDEX IF NOT EXISTS ix_audit_logs_created ON audit_logs(created_at DESC)',
    'audit_logs idx created')

# === Phase 4: Sitemap v2 — user shop scoping + cafeteria merge ===
run('ALTER TABLE users ADD COLUMN shop_id VARCHAR(50) REFERENCES shops(id) ON DELETE SET NULL', 'users.shop_id')
run('CREATE INDEX IF NOT EXISTS ix_users_shop_id ON users(shop_id)', 'users idx shop_id')
run(\"UPDATE users SET shop_id='coop'      WHERE username IN ('manager_coop','cashier_coop')       AND shop_id IS NULL\", 'users.shop_id backfill coop', ok_if_exists=False)
run(\"UPDATE users SET shop_id='sports'    WHERE username IN ('manager_sports','cashier_sports')   AND shop_id IS NULL\", 'users.shop_id backfill sports', ok_if_exists=False)
run(\"UPDATE users SET shop_id='bookstore' WHERE username IN ('manager_book','cashier_book')       AND shop_id IS NULL\", 'users.shop_id backfill bookstore', ok_if_exists=False)
run(\"UPDATE users SET shop_id='canteen'   WHERE username IN ('manager_canteen','cashier_canteen','manager_cafe','cashier_cafe') AND shop_id IS NULL\", 'users.shop_id backfill canteen', ok_if_exists=False)

# Defensive: shop_products.is_active (column exists in model; ensure DB has it for Canteen Menu toggle)
run('ALTER TABLE shop_products ADD COLUMN is_active BOOLEAN DEFAULT true NOT NULL', 'shop_products.is_active')

# Merge legacy cafeteria shop → canteen (SKIPPED - migration already completed, kept for history)
# Safety: These migrations were one-time only. Re-running could cause issues.
# run(\"UPDATE shop_products    SET shop_id='canteen' WHERE shop_id='cafeteria'\", 'cafeteria→canteen products', ok_if_exists=False)
# run(\"UPDATE shop_categories  SET shop_id='canteen' WHERE shop_id='cafeteria'\", 'cafeteria→canteen categories', ok_if_exists=False)
# run(\"UPDATE shop_movements   SET shop_id='canteen' WHERE shop_id='cafeteria'\", 'cafeteria→canteen movements', ok_if_exists=False)
# run(\"UPDATE fifo_lots        SET shop_id='canteen' WHERE shop_id='cafeteria'\", 'cafeteria→canteen fifo', ok_if_exists=False)
# run(\"UPDATE receipts         SET shop_id='canteen' WHERE shop_id='cafeteria'\", 'cafeteria→canteen receipts', ok_if_exists=False)
# run(\"UPDATE users            SET shop_id='canteen' WHERE shop_id='cafeteria'\", 'cafeteria→canteen users', ok_if_exists=False)
# run(\"DELETE FROM shops WHERE id='cafeteria'\", 'delete cafeteria shop', ok_if_exists=False)
print('  = cafeteria→canteen migration (skipped - already completed)')

# === UOM (Unit of Measure) feature ===
run('''
    CREATE TABLE IF NOT EXISTS units_of_measure (
        id SERIAL PRIMARY KEY,
        code VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        name_en VARCHAR(100),
        base_uom_id INTEGER,
        conversion_factor NUMERIC(10,4) NOT NULL DEFAULT 1,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
''', 'units_of_measure table')
run('CREATE INDEX IF NOT EXISTS ix_uom_code ON units_of_measure(code)', 'uom idx code')
run('ALTER TABLE shop_products ADD COLUMN uom_id INTEGER REFERENCES units_of_measure(id)',
    'shop_products.uom_id')
# Ensure is_active has a DB-level default (older tables may lack it)
run(\"ALTER TABLE units_of_measure ALTER COLUMN is_active SET DEFAULT true\",
    'uom is_active default', ok_if_exists=False)
# Seed default UOM values — include is_active to satisfy NOT NULL on older tables
run(\"INSERT INTO units_of_measure (code, name, name_en, conversion_factor, is_active) VALUES ('PCS', 'ชิ้น', 'Piece', 1, true) ON CONFLICT (code) DO NOTHING\",
    'uom seed PCS', ok_if_exists=False)
run(\"INSERT INTO units_of_measure (code, name, name_en, conversion_factor, is_active) VALUES ('BOX', 'กล่อง', 'Box', 1, true) ON CONFLICT (code) DO NOTHING\",
    'uom seed BOX', ok_if_exists=False)
run(\"INSERT INTO units_of_measure (code, name, name_en, conversion_factor, is_active) VALUES ('SET', 'ชุด', 'Set', 1, true) ON CONFLICT (code) DO NOTHING\",
    'uom seed SET', ok_if_exists=False)
run(\"INSERT INTO units_of_measure (code, name, name_en, conversion_factor, is_active) VALUES ('PACK', 'แพ็ค', 'Pack', 1, true) ON CONFLICT (code) DO NOTHING\",
    'uom seed PACK', ok_if_exists=False)

# === Product Bundles / Grade Sets ===
run('''
    CREATE TABLE IF NOT EXISTS product_bundles (
        id SERIAL PRIMARY KEY,
        shop_id VARCHAR(50) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        bundle_code VARCHAR(50) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        external_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        internal_price NUMERIC(10,2) NOT NULL DEFAULT 0,
        photo_url VARCHAR(500),
        color VARCHAR(50),
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
''', 'product_bundles table')
run('CREATE INDEX IF NOT EXISTS ix_product_bundles_shop ON product_bundles(shop_id)', 'product_bundles idx shop')
run('CREATE INDEX IF NOT EXISTS ix_product_bundles_code ON product_bundles(bundle_code)', 'product_bundles idx code')

run('''
    CREATE TABLE IF NOT EXISTS bundle_items (
        id SERIAL PRIMARY KEY,
        bundle_id INTEGER NOT NULL REFERENCES product_bundles(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
''', 'bundle_items table')
run('CREATE INDEX IF NOT EXISTS ix_bundle_items_bundle ON bundle_items(bundle_id)', 'bundle_items idx bundle')
run('CREATE INDEX IF NOT EXISTS ix_bundle_items_product ON bundle_items(product_id)', 'bundle_items idx product')

# === Demo May-2026: receipt_items.price_override (one-time POS override) ===
# Cashier can edit a line price at checkout. Original unit_price keeps the
# catalog price, price_override records the value charged for that line so we
# can detect overrides on receipts/audit without re-reading product history.
run('ALTER TABLE receipt_items ADD COLUMN price_override NUMERIC(10,2)',
    'receipt_items.price_override')

# === Demo May-2026: shop_products.sort_order + shops.products_order_version ===
# Per-shop product display order. Sort_order is the per-row position; the
# products_order_version on shops increments on every reorder so concurrent
# editors see a 409 conflict and can reconcile via the history table below.
run('ALTER TABLE shop_products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0',
    'shop_products.sort_order')
run('CREATE INDEX IF NOT EXISTS ix_shop_products_sort ON shop_products(shop_id, sort_order)',
    'shop_products idx sort')
run('ALTER TABLE shops ADD COLUMN products_order_version INTEGER NOT NULL DEFAULT 1',
    'shops.products_order_version')
run('''
    CREATE TABLE IF NOT EXISTS product_order_history (
        id SERIAL PRIMARY KEY,
        shop_id VARCHAR(50) NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        sort_map JSONB NOT NULL,
        changed_by INTEGER REFERENCES users(id),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        source VARCHAR(20)
    )
''', 'product_order_history table')
run('CREATE INDEX IF NOT EXISTS ix_product_order_history_shop ON product_order_history(shop_id, version DESC)',
    'product_order_history idx shop+version')
# Seed initial sort_order = id within shop so existing products get a stable
# order on first deploy. Idempotent — only fires when sort_order is still 0.
run('''
    UPDATE shop_products SET sort_order = sub.rn
    FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY shop_id ORDER BY id) AS rn
        FROM shop_products
    ) sub
    WHERE shop_products.id = sub.id AND shop_products.sort_order = 0
''', 'shop_products initial sort_order seed', ok_if_exists=False)

# === Demo May-2026: shops.uses_dual_pricing (canteen single-pricing toggle) ===
# Default true keeps existing store behaviour (Retail / Internal). Canteen is
# single-pricing per business rule; toggle stays per-shop so other deployments
# can flip it independently without code changes.
run('ALTER TABLE shop_products ADD COLUMN color VARCHAR(50)', 'shop_products.color')

# === Demo May-2026: shops.uses_dual_pricing (canteen single-pricing toggle) ===
run('ALTER TABLE shops ADD COLUMN uses_dual_pricing BOOLEAN NOT NULL DEFAULT true',
    'shops.uses_dual_pricing')
run(\"UPDATE shops SET uses_dual_pricing = false WHERE module = 'canteen'\",
    'canteen shops -> single pricing', ok_if_exists=False)
# Normalise existing canteen rows where internal_price is 0/NULL — set to retail
# so any code that still reads internal_price gets a sensible fallback.
run(\"UPDATE shop_products SET internal_price = external_price WHERE shop_id IN (SELECT id FROM shops WHERE module='canteen') AND (internal_price IS NULL OR internal_price = 0)\",
    'canteen products -> internal=external backfill', ok_if_exists=False)

# === Personal wallets for parents & staff (1 user = 1 wallet) ===
# Wallets become polymorphic: a row owns either a Customer (student/visitor —
# existing behaviour) OR a User (parent/staff — new). Keyed by user_id so a
# wallet survives role transitions (parent ↔ staff ↔ admin).
run('ALTER TABLE wallets ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL',
    'wallets.user_id')
run('CREATE UNIQUE INDEX IF NOT EXISTS ix_wallets_user_id ON wallets(user_id) WHERE user_id IS NOT NULL',
    'wallets idx user_id')
run('ALTER TABLE wallets ALTER COLUMN customer_id DROP NOT NULL',
    'wallets.customer_id nullable', ok_if_exists=False)
run(\"ALTER TABLE wallets ADD CONSTRAINT chk_wallet_owner CHECK ((customer_id IS NOT NULL AND user_id IS NULL) OR (customer_id IS NULL AND user_id IS NOT NULL))\",
    'wallets chk_wallet_owner')
# Backfill: every user role that should hold a personal wallet gets one with balance=0.
run(\"INSERT INTO wallets (user_id, balance, is_active, created_at, updated_at) SELECT u.id, 0, true, now(), now() FROM users u WHERE u.role IN ('parent','staff','cashier','manager','kitchen','admin') AND NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = u.id)\",
    'wallets backfill user owners', ok_if_exists=False)

# Receipts learn to remember user-keyed payers (parent/staff wallet purchases).
run('ALTER TABLE receipts ADD COLUMN payer_user_id INTEGER REFERENCES users(id)',
    'receipts.payer_user_id')
run('CREATE INDEX IF NOT EXISTS ix_receipts_payer_user ON receipts(payer_user_id)',
    'receipts idx payer_user')

# === Unified cardholder taxonomy: customer_kind (student/department/other) ===
# Replaces the ad-hoc PS-style customer_type string for the new admin UI.
# customer_type stays as a legacy/PS hint label (don't drop).
run('ALTER TABLE customers ADD COLUMN customer_kind VARCHAR(20)',
    'customers.customer_kind')
run('CREATE INDEX IF NOT EXISTS ix_customers_kind ON customers(customer_kind)',
    'customers idx kind')
run(\"UPDATE customers SET customer_kind = 'student' WHERE customer_type = 'Student' AND customer_kind IS NULL\",
    'customers backfill kind=student', ok_if_exists=False)
run(\"UPDATE customers SET customer_kind = 'other'   WHERE customer_type = 'Visitor' AND customer_kind IS NULL\",
    'customers backfill kind=other', ok_if_exists=False)
run(\"UPDATE customers SET customer_kind = 'other' WHERE customer_kind IS NULL\",
    'customers default kind=other', ok_if_exists=False)

# === Department wallets — 3-way polymorphic owner ===
# Wallet now owns one of {Customer, User, Department}. Department wallets
# allow negative balance (monthly credit-line cleared offline) and are debited
# at coop POS via payment_method=department.
run('ALTER TABLE wallets ADD COLUMN department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL',
    'wallets.department_id')
run('CREATE UNIQUE INDEX IF NOT EXISTS ix_wallets_department_id ON wallets(department_id) WHERE department_id IS NOT NULL',
    'wallets idx department_id')
# Drop the old 2-way constraint and re-create as 3-way exclusive.
run('ALTER TABLE wallets DROP CONSTRAINT IF EXISTS chk_wallet_owner',
    'wallets drop old chk_wallet_owner', ok_if_exists=False)
run('ALTER TABLE wallets ADD CONSTRAINT chk_wallet_owner CHECK ((customer_id IS NOT NULL)::int + (user_id IS NOT NULL)::int + (department_id IS NOT NULL)::int = 1)',
    'wallets chk_wallet_owner 3-way')

# Receipts learn to remember department-paid sales (existing payment_method=DEPARTMENT
# at coop POS now actually debits the department wallet).
run('ALTER TABLE receipts ADD COLUMN payer_department_id INTEGER REFERENCES departments(id)',
    'receipts.payer_department_id')
run('CREATE INDEX IF NOT EXISTS ix_receipts_payer_dept ON receipts(payer_department_id)',
    'receipts idx payer_dept')

# Staff requisition: who actually requested the goods (independent of cashier).
# Used by /shops/{id}/requisition endpoint and POS internal_issue mode for audit.
run('ALTER TABLE receipts ADD COLUMN requester_user_id INTEGER REFERENCES users(id)',
    'receipts.requester_user_id')
run('CREATE INDEX IF NOT EXISTS ix_receipts_requester_user_id ON receipts(requester_user_id)',
    'receipts idx requester_user')

# === System settings (runtime feature flags) ===
# Key/value store for admin-toggleable behaviour. Used by negative-balance policy
# (allow_negative_user_wallet, allow_negative_customer_wallet) and future flags.
run('''
    CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value VARCHAR(500) NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id)
    )
''', 'system_settings table')
run('CREATE INDEX IF NOT EXISTS ix_system_settings_key ON system_settings(key)',
    'system_settings idx key')
# Widen system_settings.value to TEXT to support base64 logo storage
run('ALTER TABLE system_settings ALTER COLUMN value TYPE TEXT', 'system_settings.value -> TEXT', ok_if_exists=False)

# === PowerSchool sync — per-record audit log ===
# SyncLog only stores aggregate counts; this complements it with field-level
# diffs so admin can answer "what did this sync change?".
run('''
    CREATE TABLE IF NOT EXISTS sync_audit_logs (
        id SERIAL PRIMARY KEY,
        sync_log_id INTEGER NOT NULL REFERENCES sync_logs(id) ON DELETE CASCADE,
        entity_type VARCHAR(20) NOT NULL,
        entity_id INTEGER NOT NULL,
        entity_name VARCHAR(255),
        external_id VARCHAR(50),
        action VARCHAR(20) NOT NULL,
        changes JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
''', 'sync_audit_logs table')
run('CREATE INDEX IF NOT EXISTS ix_sync_audit_log_id ON sync_audit_logs(sync_log_id)',
    'sync_audit idx log')
run('CREATE INDEX IF NOT EXISTS ix_sync_audit_entity ON sync_audit_logs(entity_type, entity_id)',
    'sync_audit idx entity')

# === Canteen multi-stall: users.shop_module (area manager module assignment) ===
run('ALTER TABLE users ADD COLUMN IF NOT EXISTS shop_module VARCHAR(20)',
    'users.shop_module')

# === Feature 9: multi-login restriction (one active session per user) ===
run('ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token VARCHAR(64)', 'users.session_token', ok_if_exists=False)
run('ALTER TABLE users ADD COLUMN IF NOT EXISTS staff_type VARCHAR(30)', 'users.staff_type')
run('ALTER TABLE users ADD COLUMN IF NOT EXISTS ps_department VARCHAR(100)', 'users.ps_department')
# Backfill shop_module for existing canteen users who have a shop_id starting with 'canteen'
run(\"UPDATE users SET shop_module = 'canteen' WHERE shop_id IN (SELECT id FROM shops WHERE module = 'canteen') AND shop_module IS NULL\",
    'users.shop_module backfill canteen', ok_if_exists=False)

# === Reversal links on shop_movements (so adjustments can be undone with audit trail) ===
run('ALTER TABLE shop_movements ADD COLUMN IF NOT EXISTS reverses_id INTEGER REFERENCES shop_movements(id) ON DELETE SET NULL',
    'shop_movements.reverses_id')
run('ALTER TABLE shop_movements ADD COLUMN IF NOT EXISTS reversed_by_id INTEGER REFERENCES shop_movements(id) ON DELETE SET NULL',
    'shop_movements.reversed_by_id')

# === Verification: fail loudly if critical columns/tables are still missing ===
required_cols = [
    ('users', 'role'),
    ('users', 'external_id'),
    ('users', 'family_code'),
    ('users', 'photo_url'),
    ('users', 'status'),
    ('users', 'last_synced_at'),
    ('users', 'allergies'),
    ('customers', 'student_code'),
    ('customers', 'grade'),
    ('customers', 'allergies'),
    ('customers', 'dietary_notes'),
    ('customers', 'card_uid'),
    ('customers', 'card_frozen'),
    ('customers', 'daily_limit'),
    ('customers', 'powerschool_sync_at'),
    ('customers', 'negative_credit_limit'),
    ('customers', 'allergy_override_note'),
    ('customers', 'family_code'),
    ('customers', 'external_id'),
    ('customers', 'customer_type'),
    ('customers', 'school_type'),
    ('users', 'card_uid'),
    ('users', 'customer_type'),
    ('parent_child_links', 'parent_rank'),
    ('receipts', 'shop_id'),
    ('users', 'shop_id'),
    ('shop_products', 'is_active'),
    ('shop_products', 'sort_order'),
    ('shop_products', 'color'),
    ('shops', 'uses_dual_pricing'),
    ('shops', 'products_order_version'),
    ('receipt_items', 'price_override'),
    ('receipt_items', 'options'),
    ('wallets', 'user_id'),
    ('receipts', 'payer_user_id'),
    ('customers', 'customer_kind'),
    ('wallets', 'department_id'),
    ('receipts', 'payer_department_id'),
    ('receipts', 'requester_user_id'),
    ('users', 'shop_module'),
    ('users', 'session_token'),
    ('users', 'staff_type'),
    ('users', 'ps_department'),
    ('shop_movements', 'reverses_id'),
    ('shop_movements', 'reversed_by_id'),
]
required_tables = [
    'parent_child_links', 'payment_intents', 'identity_mappings', 'sync_logs',
    'family_profiles', 'menu_option_groups', 'menu_options', 'audit_logs',
    'product_order_history', 'sync_audit_logs',
]

missing = []
with engine.begin() as conn:
    for t, c in required_cols:
        row = conn.execute(
            text('SELECT 1 FROM information_schema.columns WHERE table_name=:t AND column_name=:c'),
            {'t': t, 'c': c},
        ).first()
        if not row:
            missing.append(f'{t}.{c}')
    for t in required_tables:
        row = conn.execute(
            text('SELECT 1 FROM information_schema.tables WHERE table_name=:t'),
            {'t': t},
        ).first()
        if not row:
            missing.append(f'table:{t}')

if missing:
    print(f'!!! SCHEMA VERIFICATION FAILED — missing: {missing}', file=sys.stderr)
    sys.exit(1)
else:
    print('  ✓ schema verification passed')
" || { echo "!!! SCHEMA PATCH CRASHED — refusing to start" >&2; exit 1; }

# Backward-compat heads-up for the negative-balance policy change (2026-05-08).
# Customer/user wallets that are already negative from the legacy "negative-allowed"
# era will be blocked from POS purchases until they top up to ≥ 0 (or admin grants
# customer.negative_credit_limit). This is informational only — does NOT fail boot.
echo "=== Negative-balance backward-compat check ==="
python -c "
from sqlalchemy import text
from app.core.database import engine
with engine.connect() as conn:
    rows = conn.execute(text('''
        SELECT
            COUNT(*) FILTER (WHERE customer_id IS NOT NULL AND balance < 0) AS customer_neg,
            COUNT(*) FILTER (WHERE user_id     IS NOT NULL AND balance < 0) AS user_neg,
            COUNT(*) FILTER (WHERE department_id IS NOT NULL AND balance < 0) AS dept_neg
        FROM wallets
    ''')).fetchone()
    cust, usr, dept = rows[0] or 0, rows[1] or 0, rows[2] or 0
    if cust or usr:
        print(f'  ⚠ {cust} customer + {usr} user wallets currently NEGATIVE — those owners cannot purchase until balance is restored or admin grants overdraft. (Department negatives: {dept}, allowed.)')
    else:
        print(f'  ✓ no customer/user wallets are negative (department: {dept}, allowed)')
" || echo "  (compat check skipped — non-fatal)"

echo "=== Seeding data ==="
SEED_MODE="${SEED_MODE:-incremental}"
case "$SEED_MODE" in
    skip)
        echo "  SEED_MODE=skip — not running seed.py"
        ;;
    incremental)
        echo "  SEED_MODE=incremental — running seed.py (idempotent upsert)"
        python seed.py || echo "Seed skipped (data may already exist)"
        ;;
    reset)
        echo "  SEED_MODE=reset — wiping data and re-seeding (DEV ONLY)"
        python seed.py --reset || { echo "!!! Seed-reset failed" >&2; exit 1; }
        ;;
    handoff)
        echo "  SEED_MODE=handoff — wiping data, leaving admin only"
        HANDOFF_CONFIRM=1 python seed.py --handoff --yes || { echo "!!! Handoff failed" >&2; exit 1; }
        ;;
    *)
        echo "  WARN: unknown SEED_MODE='$SEED_MODE' — falling back to incremental"
        python seed.py || echo "Seed skipped"
        ;;
esac

echo "=== Starting server on port ${PORT:-8000} ==="
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
