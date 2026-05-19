"""
Seed Script — populate shops, categories, sample products, and ALL demo users.
Matches the frontend AuthContext mock users exactly so every account can log in.

Usage:
    cd backend
    python seed.py                       # incremental (skip existing)
    python seed.py --reset               # drop all data first, then full re-seed
    python seed.py --handoff --yes       # PRODUCTION: wipe everything, leave only admin
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import date, datetime
from app.core.database import SessionLocal, engine, Base
from app.core.security import get_password_hash
from app.models import *  # ensure all tables exist

# Auto-create tables (idempotent)
Base.metadata.create_all(bind=engine)

db = SessionLocal()


# ── helpers ───────────────────────────────────────────────────────────────────

def upsert_shop(id, name, shop_type, description="", allow_department_charge=False, module="store"):
    from app.models.shop import Shop, ShopType
    shop = db.query(Shop).filter(Shop.id == id).first()
    if not shop:
        shop = Shop(
            id=id,
            name=name,
            shop_type=ShopType(shop_type),
            description=description,
            allow_department_charge=allow_department_charge,
            module=module,
        )
        db.add(shop)
        print(f"  + Shop: {id} (module={module})")
    else:
        # Backfill if existing row was seeded before column existed
        if getattr(shop, "allow_department_charge", None) is None:
            shop.allow_department_charge = allow_department_charge
        if getattr(shop, "module", None) != module:
            shop.module = module
    return shop


def upsert_category(shop_id, cat_id, name):
    from app.models.shop import ShopCategory
    cat = db.query(ShopCategory).filter(ShopCategory.id == cat_id).first()
    if not cat:
        cat = ShopCategory(id=cat_id, shop_id=shop_id, name=name)
        db.add(cat)
        print(f"    + Category: {name}")
    return cat


def upsert_product(shop_id, shop_type, **kwargs):
    from app.models.shop import Shop, ShopProduct, ShopMovement, MovementType
    from app.models.fifo_lot import FifoLot

    existing = db.query(ShopProduct).filter(
        ShopProduct.shop_id == shop_id,
        ShopProduct.product_code == kwargs["product_code"],
    ).first()
    if existing:
        return existing

    # Canteen shops are menu-only (no stock/cost tracking) — drop the
    # numeric stock-related fields so seed callers can stay uniform.
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    is_canteen = bool(shop and shop.module == "canteen")
    if is_canteen:
        kwargs["avg_cost"] = 0
        kwargs["stock"] = 0
        kwargs["min_stock"] = 0

    p = ShopProduct(
        shop_id=shop_id,
        product_code=kwargs["product_code"],
        barcode=kwargs.get("barcode"),
        name=kwargs["name"],
        category=kwargs.get("category", "ทั่วไป"),
        external_price=kwargs.get("external_price", 0),
        internal_price=kwargs.get("internal_price", kwargs.get("external_price", 0)),
        vat_percent=kwargs.get("vat_percent", 7),
        avg_cost=kwargs.get("avg_cost", 0),
        stock=kwargs.get("stock", 0),
        min_stock=kwargs.get("min_stock", 0),
        photo_url=kwargs.get("photo_url"),
    )
    db.add(p)
    db.flush()

    init_stock = kwargs.get("stock", 0)
    if init_stock > 0:
        if shop_type == "fifo":
            lot = FifoLot(
                id=f"init-{p.id}",
                product_id=p.id,
                shop_id=shop_id,
                date=date(2026, 1, 1),
                qty_remaining=init_stock,
                cost_per_unit=kwargs.get("avg_cost", 0),
            )
            db.add(lot)

        mv = ShopMovement(
            date=date(2026, 1, 1),
            product_id=p.id,
            product_name=p.name,
            shop_id=shop_id,
            type=MovementType.receive,
            quantity=init_stock,
            stock_before=0,
            stock_after=init_stock,
            cost_per_unit=kwargs.get("avg_cost"),
            note="Initial stock (seed)",
        )
        db.add(mv)

    suffix = "(menu)" if is_canteen else f"(stock={init_stock})"
    print(f"    + Product: {kwargs['name']} {suffix}")
    return p


def _dicebear(role_key: str, seed: str) -> str:
    """Deterministic realistic mock portrait (delegates to powerschool_sync pools).

    Name kept as-is to avoid churn on call sites — the implementation just
    proxies the curated randomuser.me pools defined in powerschool_sync.
    """
    from app.services.powerschool_sync import _realistic_photo
    return _realistic_photo(role_key, seed)


# Roles that get a personal wallet (mirrors WALLET_ROLES in user_service).
WALLET_ROLES = {"parent", "staff", "cashier", "manager", "kitchen", "admin"}


def upsert_user(username, password, full_name, email, is_superuser=False, role="cashier",
                external_id=None, family_code=None, shop_id=None, photo_url=None,
                wallet_balance=None):
    """Upsert a User row and (optionally) seed a personal wallet for them.

    `wallet_balance` is THB; pass a positive number to pre-load the wallet for
    demo flows (POS spend, topup, family transfer). Wallet creation is gated to
    `WALLET_ROLES` so non-wallet roles (student/teacher/etc.) won't accidentally
    get a User-keyed wallet.
    """
    from app.models.user import User
    user = db.query(User).filter(User.username == username).first()
    if not user:
        user = User(
            username=username,
            email=email,
            hashed_password=get_password_hash(password),
            full_name=full_name,
            is_active=True,
            is_superuser=is_superuser,
            role=role,
            external_id=external_id,
            family_code=family_code,
            shop_id=shop_id,
            status="active",
            photo_url=photo_url or _dicebear(role, username),
        )
        db.add(user)
        print(f"  + User: {username} / {password} (role={role})")
    else:
        # Backfill Phase 3.5 fields on existing users (idempotent)
        dirty = False
        if external_id and not user.external_id:
            user.external_id = external_id
            dirty = True
        if family_code and not user.family_code:
            user.family_code = family_code
            dirty = True
        if shop_id and not getattr(user, "shop_id", None):
            user.shop_id = shop_id
            dirty = True
        if not user.status:
            user.status = "active"
            dirty = True
        if not user.photo_url:
            user.photo_url = photo_url or _dicebear(role, username)
            dirty = True
        if dirty:
            print(f"  = User: {username} (backfilled external_id/family_code/shop_id/photo_url)")

    # Personal wallet — only for wallet-eligible roles, only if missing or zero.
    if role in WALLET_ROLES:
        from app.models.wallet import Wallet
        db.flush()  # need user.id
        w = db.query(Wallet).filter(Wallet.user_id == user.id).first()
        if not w:
            w = Wallet(user_id=user.id, balance=wallet_balance or 0, is_active=True)
            db.add(w)
            if wallet_balance:
                print(f"    ↳ wallet seeded ฿{wallet_balance:.0f}")
        elif wallet_balance and float(w.balance) == 0:
            # Demo refresh: bring zero balances up to the requested seed amount.
            w.balance = wallet_balance
            print(f"    ↳ wallet topped up to ฿{wallet_balance:.0f}")

    return user


def upsert_student(code, name, student_code, grade, card_uid=None, allergies=None,
                   dietary_notes=None, photo_url=None, initial_balance=500,
                   external_id=None, family_code=None):
    """Create a Customer (student) with wallet."""
    from app.models.customer import Customer, CustomerType, CustomerTypeEnum
    from app.models.wallet import Wallet

    c = db.query(Customer).filter(Customer.customer_code == code).first()
    if c:
        # Backfill Phase 3.5 fields
        dirty = False
        if external_id and not c.external_id:
            c.external_id = external_id
            dirty = True
        if family_code and not c.family_code:
            c.family_code = family_code
            dirty = True
        if dirty:
            print(f"  = Student: {name} (backfilled external_id/family_code)")
        return c

    # Ensure INTERNAL customer type exists
    ct = db.query(CustomerType).filter(CustomerType.type_name == CustomerTypeEnum.INTERNAL).first()
    if not ct:
        ct = CustomerType(
            type_name=CustomerTypeEnum.INTERNAL,
            description="Student/staff internal customer",
            default_price_level="internal",
        )
        db.add(ct)
        db.flush()

    c = Customer(
        customer_code=code,
        student_code=student_code,
        name=name,
        grade=grade,
        card_uid=card_uid,
        allergies=allergies,
        dietary_notes=dietary_notes,
        photo_url=photo_url or _dicebear("student", student_code or code),
        customer_type_id=ct.id,
        is_active=True,
        card_frozen=False,
        external_id=external_id,
        family_code=family_code,
        customer_kind="student",
    )
    db.add(c)
    db.flush()

    # Create wallet with initial balance
    w = Wallet(customer_id=c.id, balance=initial_balance, is_active=True)
    db.add(w)
    print(f"  + Student: {name} ({student_code}) — balance ฿{initial_balance}")
    return c


def upsert_parent_link(parent_username, child_student_code, relation="guardian"):
    """Link parent User to child Customer by student_code."""
    from app.models.user import User
    from app.models.customer import Customer
    from app.models.parent_child_link import ParentChildLink

    parent = db.query(User).filter(User.username == parent_username).first()
    child = db.query(Customer).filter(Customer.student_code == child_student_code).first()
    if not parent or not child:
        return None

    existing = (
        db.query(ParentChildLink)
        .filter(
            ParentChildLink.parent_user_id == parent.id,
            ParentChildLink.child_customer_id == child.id,
        )
        .first()
    )
    if existing:
        return existing

    link = ParentChildLink(
        parent_user_id=parent.id,
        child_customer_id=child.id,
        relation=relation,
    )
    db.add(link)
    print(f"  + Link: {parent_username} ↔ {child_student_code} ({relation})")
    return link


def reset_db():
    """Drop all data (not tables) for a clean re-seed.

    Deletes leaf-first to satisfy FK constraints. sync_audit_logs cascades
    automatically when sync_logs are deleted (FK ON DELETE CASCADE).
    """
    from app.models.shop import (
        ShopMovement, ShopProduct, ShopCategory, Shop,
        MenuOptionGroup, MenuOption, ProductOrderHistory,
    )
    from app.models.fifo_lot import FifoLot
    from app.models.receipt import Receipt, ReceiptItem
    from app.models.return_request import ReturnRequest
    from app.models.credit_note import CreditNote
    from app.models.user import User
    from app.models.wallet import Wallet, WalletTransaction
    from app.models.customer import Customer, CustomerType
    from app.models.parent_child_link import ParentChildLink
    from app.models.payment_intent import PaymentIntent
    from app.models.identity_mapping import IdentityMapping
    from app.models.sync_log import SyncLog
    from app.models.family_profile import FamilyProfile
    from app.models.audit_log import AuditLog
    from app.models.department import Department, BudgetTransaction
    from app.models.approval import ApprovalRequest
    from app.models.barcode import Barcode

    print("Resetting database...")
    # 1. Refunds / receipts (deepest leaves)
    db.query(ReturnRequest).delete()
    db.query(CreditNote).delete()
    db.query(ReceiptItem).delete()
    db.query(Receipt).delete()
    # 2. Inventory movements / FIFO lots
    db.query(ShopMovement).delete()
    db.query(FifoLot).delete()
    # 3. Menu options / barcodes / per-shop catalogue
    db.query(MenuOption).delete()
    db.query(MenuOptionGroup).delete()
    db.query(ProductOrderHistory).delete()
    db.query(Barcode).delete()
    db.query(ShopProduct).delete()
    db.query(ShopCategory).delete()
    db.query(Shop).delete()
    # 4. Wallet / payment / department-budget transactions
    db.query(PaymentIntent).delete()
    db.query(WalletTransaction).delete()
    db.query(Wallet).delete()
    db.query(BudgetTransaction).delete()
    # 5. Approvals / audit log (FK → users)
    db.query(ApprovalRequest).delete()
    db.query(AuditLog).delete()
    # 6. Family graph
    db.query(ParentChildLink).delete()
    db.query(FamilyProfile).delete()
    # 7. Sync history (CASCADE drops sync_audit_logs)
    db.query(IdentityMapping).delete()
    db.query(SyncLog).delete()
    # 8. Cardholder roots
    db.query(Customer).delete()
    db.query(CustomerType).delete()
    db.query(Department).delete()
    db.query(User).delete()
    db.commit()
    print("  All data cleared.\n")


# ── seed data ─────────────────────────────────────────────────────────────────

def backfill_realistic_photos():
    """Update existing User / Customer rows whose photo_url is NULL or points
    at an obsolete stub (placehold.co, dicebear.com). Runs every seed so that
    production rows created before the realistic-portrait rollout catch up
    without needing a destructive --reset.
    """
    from app.models.user import User
    from app.models.customer import Customer

    def _stale(url):
        if not url:
            return True
        return "placehold.co" in url or "dicebear.com" in url

    def _role_for_user(u):
        if u.role == "staff":
            return "staff"
        if u.role == "parent":
            return "parent"
        # admin / manager / cashier / teacher etc. reuse the staff pool.
        return "staff"

    def _role_for_customer(c):
        if (c.customer_type or "").lower() == "visitor":
            return "visitor"
        return "student"

    user_updated = 0
    for u in db.query(User).all():
        if _stale(u.photo_url):
            seed = u.external_id or u.username or str(u.id)
            u.photo_url = _dicebear(_role_for_user(u), seed)
            user_updated += 1

    cust_updated = 0
    for c in db.query(Customer).all():
        if _stale(c.photo_url):
            seed = c.external_id or c.student_code or c.customer_code or str(c.id)
            c.photo_url = _dicebear(_role_for_customer(c), seed)
            cust_updated += 1

    if user_updated or cust_updated:
        db.commit()
        print(f"  Backfilled realistic photos — users: {user_updated}, customers: {cust_updated}")


def seed():
    # ── Backfill photos on existing rows BEFORE seeding new ones ──────────
    backfill_realistic_photos()

    # ── Shops (4) ──────────────────────────────────────────────────────────
    print("Seeding shops...")
    upsert_shop("coop",       "Coop Shop",      "fifo",     "ร้านสหกรณ์โรงเรียน — FIFO",
                allow_department_charge=True)
    upsert_shop("sports",     "Sports Shop",    "fifo",     "ร้านอุปกรณ์กีฬา — FIFO")
    upsert_shop("bookstore",  "Bookstore",      "fifo",     "ร้านหนังสือ — FIFO")
    upsert_shop("canteen",    "ISB Canteen",    "avg_cost",
                "Tablet canteen POS — RFID-first, warm yellow theme",
                allow_department_charge=True, module="canteen")
    # Demo canteens (multi-shop capability)
    upsert_shop("canteen_thai",   "Thai Kitchen",    "avg_cost",
                "ครัวอาหารไทย — ข้าว ก๋วยเตี๋ยว ต้มยำ",
                allow_department_charge=True, module="canteen")
    upsert_shop("canteen_drinks", "Drinks & Snacks", "avg_cost",
                "เครื่องดื่มและของว่าง",
                allow_department_charge=True, module="canteen")

    # ── Categories ─────────────────────────────────────────────────────────
    print("\nSeeding categories...")
    # Coop
    upsert_category("coop", "cat-coop-1", "เครื่องเขียน")
    upsert_category("coop", "cat-coop-2", "เครื่องดื่ม")
    upsert_category("coop", "cat-coop-3", "ขนม/อาหาร")
    upsert_category("coop", "cat-coop-4", "เครื่องใช้")
    # Sports
    upsert_category("sports", "cat-sports-1", "เสื้อผ้า")
    upsert_category("sports", "cat-sports-2", "อุปกรณ์กีฬา")
    # Bookstore
    upsert_category("bookstore", "cat-book-1", "หนังสือเรียน")
    upsert_category("bookstore", "cat-book-2", "อุปกรณ์การเรียน")
    # Canteen — English-first, tablet POS categories
    upsert_category("canteen", "cat-can-thai",     "Thai")
    upsert_category("canteen", "cat-can-western",  "Western")
    upsert_category("canteen", "cat-can-drinks",   "Drinks")
    upsert_category("canteen", "cat-can-snacks",   "Snacks")
    upsert_category("canteen", "cat-can-desserts", "Desserts")
    # Thai Kitchen
    upsert_category("canteen_thai", "cat-thai-rice",  "อาหารจานเดียว")
    upsert_category("canteen_thai", "cat-thai-soup",  "อาหารน้ำ")
    # Drinks & Snacks
    upsert_category("canteen_drinks", "cat-drk-beverage", "เครื่องดื่ม")
    upsert_category("canteen_drinks", "cat-drk-snack",    "ขนม")

    # ── Products: Coop Shop (avg_cost) ─────────────────────────────────────
    print("\nSeeding products — Coop Shop (avg_cost)...")
    upsert_product("coop", "fifo",
        product_code="P001", barcode="8850999123456", name="ดินสอ HB",
        category="เครื่องเขียน", external_price=5, internal_price=5,
        vat_percent=0, avg_cost=2.50, stock=200, min_stock=50)
    upsert_product("coop", "fifo",
        product_code="P002", barcode="8850999123457", name="ยางลบ",
        category="เครื่องเขียน", external_price=3, internal_price=3,
        vat_percent=0, avg_cost=1.20, stock=150, min_stock=30)
    upsert_product("coop", "fifo",
        product_code="P003", barcode="8850999123458", name="น้ำดื่มตราช้าง 600ml",
        category="เครื่องดื่ม", external_price=7, internal_price=6,
        vat_percent=7, avg_cost=4.50, stock=10, min_stock=20)
    upsert_product("coop", "fifo",
        product_code="P004", barcode="8850999123459", name="ผงซักฟอก 1kg",
        category="เครื่องใช้", external_price=45, internal_price=40,
        vat_percent=7, avg_cost=28.00, stock=8, min_stock=15)
    upsert_product("coop", "fifo",
        product_code="P005", barcode="8850999123460", name="สมุด 40 แผ่น",
        category="เครื่องเขียน", external_price=12, internal_price=10,
        vat_percent=0, avg_cost=6.00, stock=300, min_stock=50)
    upsert_product("coop", "fifo",
        product_code="P006", barcode="8850999123461", name="ปากกาลูกลื่น",
        category="เครื่องเขียน", external_price=8, internal_price=8,
        vat_percent=0, avg_cost=3.50, stock=180, min_stock=40)

    # ── Products: Sports Shop (fifo) ───────────────────────────────────────
    print("\nSeeding products — Sports Shop (fifo)...")
    upsert_product("sports", "fifo",
        product_code="SP001", barcode="8851234567890", name="เสื้อกีฬาสีขาว (M)",
        category="เสื้อผ้า", external_price=180, internal_price=160,
        vat_percent=7, avg_cost=95.00, stock=30, min_stock=10)
    upsert_product("sports", "fifo",
        product_code="SP002", barcode="8851234567891", name="ลูกฟุตบอล",
        category="อุปกรณ์กีฬา", external_price=350, internal_price=300,
        vat_percent=7, avg_cost=200.00, stock=15, min_stock=5)
    upsert_product("sports", "fifo",
        product_code="SP003", barcode="8851234567892", name="ถุงเท้ากีฬา",
        category="เสื้อผ้า", external_price=35, internal_price=30,
        vat_percent=7, avg_cost=18.00, stock=60, min_stock=20)
    upsert_product("sports", "fifo",
        product_code="SP004", barcode="8851234567893", name="กางเกงวอร์ม (L)",
        category="เสื้อผ้า", external_price=250, internal_price=220,
        vat_percent=7, avg_cost=130.00, stock=20, min_stock=8)
    upsert_product("sports", "fifo",
        product_code="SP005", barcode="8851234567894", name="ไม้แบดมินตัน",
        category="อุปกรณ์กีฬา", external_price=290, internal_price=260,
        vat_percent=7, avg_cost=150.00, stock=12, min_stock=5)

    # ── Products: Bookstore (fifo) ─────────────────────────────────────────
    print("\nSeeding products — Bookstore (fifo)...")
    upsert_product("bookstore", "fifo",
        product_code="BK001", barcode="9780000000001", name="หนังสือคณิตศาสตร์ ม.1",
        category="หนังสือเรียน", external_price=120, internal_price=110,
        vat_percent=0, avg_cost=70.00, stock=25, min_stock=5)
    upsert_product("bookstore", "fifo",
        product_code="BK002", barcode="9780000000002", name="สมุดบันทึก A4 80 แผ่น",
        category="อุปกรณ์การเรียน", external_price=35, internal_price=30,
        vat_percent=0, avg_cost=20.00, stock=80, min_stock=20)
    upsert_product("bookstore", "fifo",
        product_code="BK003", barcode="9780000000003", name="หนังสือวิทยาศาสตร์ ม.1",
        category="หนังสือเรียน", external_price=130, internal_price=120,
        vat_percent=0, avg_cost=75.00, stock=20, min_stock=5)
    upsert_product("bookstore", "fifo",
        product_code="BK004", barcode="9780000000004", name="หนังสือภาษาอังกฤษ ม.1",
        category="หนังสือเรียน", external_price=110, internal_price=100,
        vat_percent=0, avg_cost=65.00, stock=30, min_stock=5)
    upsert_product("bookstore", "fifo",
        product_code="BK005", barcode="9780000000005", name="ดินสอสี 12 แท่ง",
        category="อุปกรณ์การเรียน", external_price=45, internal_price=40,
        vat_percent=0, avg_cost=25.00, stock=50, min_stock=10)

    # ── Products: Canteen (avg_cost) — tablet POS, English-first ───────────
    print("\nSeeding products — Canteen (avg_cost)...")
    # Thai
    upsert_product("canteen", "avg_cost",
        product_code="CT-THAI-01", name="Pad Thai",
        category="Thai", external_price=55, internal_price=50,
        vat_percent=0, avg_cost=22.00, stock=80, min_stock=10)
    upsert_product("canteen", "avg_cost",
        product_code="CT-THAI-02", name="Khao Pad Gai",
        category="Thai", external_price=50, internal_price=45,
        vat_percent=0, avg_cost=20.00, stock=80, min_stock=10)
    upsert_product("canteen", "avg_cost",
        product_code="CT-THAI-03", name="Tom Yum Noodles",
        category="Thai", external_price=60, internal_price=55,
        vat_percent=0, avg_cost=25.00, stock=60, min_stock=10)
    upsert_product("canteen", "avg_cost",
        product_code="CT-THAI-04", name="Green Curry Rice",
        category="Thai", external_price=65, internal_price=60,
        vat_percent=0, avg_cost=28.00, stock=60, min_stock=10)
    # Western
    upsert_product("canteen", "avg_cost",
        product_code="CT-WEST-01", name="Margherita Pizza Slice",
        category="Western", external_price=60, internal_price=55,
        vat_percent=0, avg_cost=24.00, stock=50, min_stock=10)
    upsert_product("canteen", "avg_cost",
        product_code="CT-WEST-02", name="Cheeseburger",
        category="Western", external_price=90, internal_price=80,
        vat_percent=0, avg_cost=38.00, stock=40, min_stock=10)
    upsert_product("canteen", "avg_cost",
        product_code="CT-WEST-03", name="Chicken Caesar Wrap",
        category="Western", external_price=80, internal_price=70,
        vat_percent=0, avg_cost=32.00, stock=40, min_stock=10)
    upsert_product("canteen", "avg_cost",
        product_code="CT-WEST-04", name="Spaghetti Bolognese",
        category="Western", external_price=95, internal_price=85,
        vat_percent=0, avg_cost=40.00, stock=35, min_stock=10)
    # Drinks
    upsert_product("canteen", "avg_cost",
        product_code="CT-DRNK-01", name="Fresh Orange Juice",
        category="Drinks", external_price=35, internal_price=30,
        vat_percent=0, avg_cost=12.00, stock=100, min_stock=20)
    upsert_product("canteen", "avg_cost",
        product_code="CT-DRNK-02", name="Thai Iced Milk Tea",
        category="Drinks", external_price=30, internal_price=25,
        vat_percent=0, avg_cost=10.00, stock=100, min_stock=20)
    upsert_product("canteen", "avg_cost",
        product_code="CT-DRNK-03", name="Iced Latte",
        category="Drinks", external_price=45, internal_price=40,
        vat_percent=0, avg_cost=15.00, stock=80, min_stock=15)
    upsert_product("canteen", "avg_cost",
        product_code="CT-DRNK-04", name="Sparkling Water",
        category="Drinks", external_price=25, internal_price=20,
        vat_percent=0, avg_cost=8.00, stock=120, min_stock=30)
    # Snacks
    upsert_product("canteen", "avg_cost",
        product_code="CT-SNCK-01", name="French Fries",
        category="Snacks", external_price=40, internal_price=35,
        vat_percent=0, avg_cost=14.00, stock=80, min_stock=15)
    upsert_product("canteen", "avg_cost",
        product_code="CT-SNCK-02", name="Chicken Nuggets (6 pcs)",
        category="Snacks", external_price=55, internal_price=50,
        vat_percent=0, avg_cost=22.00, stock=60, min_stock=15)
    upsert_product("canteen", "avg_cost",
        product_code="CT-SNCK-03", name="Spring Rolls (3 pcs)",
        category="Snacks", external_price=35, internal_price=30,
        vat_percent=0, avg_cost=13.00, stock=70, min_stock=15)
    upsert_product("canteen", "avg_cost",
        product_code="CT-SNCK-04", name="Fruit Cup",
        category="Snacks", external_price=30, internal_price=25,
        vat_percent=0, avg_cost=12.00, stock=90, min_stock=20)
    # Desserts
    upsert_product("canteen", "avg_cost",
        product_code="CT-DSRT-01", name="Mango Sticky Rice",
        category="Desserts", external_price=50, internal_price=45,
        vat_percent=0, avg_cost=20.00, stock=50, min_stock=10)
    upsert_product("canteen", "avg_cost",
        product_code="CT-DSRT-02", name="Chocolate Brownie",
        category="Desserts", external_price=45, internal_price=40,
        vat_percent=0, avg_cost=18.00, stock=40, min_stock=10)
    upsert_product("canteen", "avg_cost",
        product_code="CT-DSRT-03", name="Vanilla Ice Cream Cup",
        category="Desserts", external_price=35, internal_price=30,
        vat_percent=0, avg_cost=14.00, stock=80, min_stock=15)
    upsert_product("canteen", "avg_cost",
        product_code="CT-DSRT-04", name="Coconut Jelly",
        category="Desserts", external_price=30, internal_price=25,
        vat_percent=0, avg_cost=12.00, stock=70, min_stock=15)

    # ── Products: Thai Kitchen (canteen_thai, avg_cost) ────────────────────
    print("\nSeeding products — Thai Kitchen...")
    _thai_photo = lambda tag: f"https://placehold.co/200x200/f59e0b/fff?text={tag}"
    upsert_product("canteen_thai", "avg_cost",
        product_code="THAI001", name="ข้าวผัดไก่",
        category="อาหารจานเดียว", external_price=45, internal_price=40,
        vat_percent=0, avg_cost=22.00, stock=50, min_stock=10, photo_url=_thai_photo("Fried+Rice"))
    upsert_product("canteen_thai", "avg_cost",
        product_code="THAI002", name="ข้าวผัดหมู",
        category="อาหารจานเดียว", external_price=45, internal_price=40,
        vat_percent=0, avg_cost=22.00, stock=50, min_stock=10, photo_url=_thai_photo("Pork+Rice"))
    upsert_product("canteen_thai", "avg_cost",
        product_code="THAI003", name="ผัดไทยกุ้งสด",
        category="อาหารจานเดียว", external_price=55, internal_price=50,
        vat_percent=0, avg_cost=28.00, stock=40, min_stock=10, photo_url=_thai_photo("Pad+Thai"))
    upsert_product("canteen_thai", "avg_cost",
        product_code="THAI004", name="ต้มยำกุ้ง",
        category="อาหารน้ำ", external_price=65, internal_price=58,
        vat_percent=0, avg_cost=35.00, stock=30, min_stock=8, photo_url=_thai_photo("Tom+Yum"))
    upsert_product("canteen_thai", "avg_cost",
        product_code="THAI005", name="ก๋วยเตี๋ยวหมูน้ำใส",
        category="อาหารน้ำ", external_price=40, internal_price=35,
        vat_percent=0, avg_cost=20.00, stock=60, min_stock=15, photo_url=_thai_photo("Noodle"))
    upsert_product("canteen_thai", "avg_cost",
        product_code="THAI006", name="ไข่เจียวหมูสับ",
        category="อาหารจานเดียว", external_price=35, internal_price=30,
        vat_percent=0, avg_cost=15.00, stock=45, min_stock=10, photo_url=_thai_photo("Omelette"))
    upsert_product("canteen_thai", "avg_cost",
        product_code="THAI007", name="แกงเขียวหวานไก่ + ข้าว",
        category="อาหารจานเดียว", external_price=50, internal_price=45,
        vat_percent=0, avg_cost=25.00, stock=35, min_stock=8, photo_url=_thai_photo("Green+Curry"))

    # ── Products: Drinks & Snacks (canteen_drinks, avg_cost) ───────────────
    print("\nSeeding products — Drinks & Snacks...")
    _drk_photo = lambda tag: f"https://placehold.co/200x200/0ea5e9/fff?text={tag}"
    _snk_photo = lambda tag: f"https://placehold.co/200x200/ec4899/fff?text={tag}"
    upsert_product("canteen_drinks", "avg_cost",
        product_code="DRK001", name="ชาเย็น",
        category="เครื่องดื่ม", external_price=20, internal_price=18,
        vat_percent=0, avg_cost=10.00, stock=80, min_stock=20, photo_url=_drk_photo("Thai+Tea"))
    upsert_product("canteen_drinks", "avg_cost",
        product_code="DRK002", name="กาแฟเย็น",
        category="เครื่องดื่ม", external_price=25, internal_price=22,
        vat_percent=0, avg_cost=12.00, stock=80, min_stock=20, photo_url=_drk_photo("Iced+Coffee"))
    upsert_product("canteen_drinks", "avg_cost",
        product_code="DRK003", name="นมเย็น",
        category="เครื่องดื่ม", external_price=20, internal_price=18,
        vat_percent=0, avg_cost=10.00, stock=70, min_stock=15, photo_url=_drk_photo("Milk"))
    upsert_product("canteen_drinks", "avg_cost",
        product_code="DRK004", name="โกโก้เย็น",
        category="เครื่องดื่ม", external_price=25, internal_price=22,
        vat_percent=0, avg_cost=12.00, stock=60, min_stock=15, photo_url=_drk_photo("Cocoa"))
    upsert_product("canteen_drinks", "avg_cost",
        product_code="DRK005", name="น้ำส้มคั้น 250ml",
        category="เครื่องดื่ม", external_price=30, internal_price=25,
        vat_percent=0, avg_cost=15.00, stock=40, min_stock=10, photo_url=_drk_photo("Orange"))
    upsert_product("canteen_drinks", "avg_cost",
        product_code="SNK001", name="ขนมปังสังขยา",
        category="ขนม", external_price=15, internal_price=12,
        vat_percent=0, avg_cost=7.00, stock=50, min_stock=15, photo_url=_snk_photo("Kaya"))
    upsert_product("canteen_drinks", "avg_cost",
        product_code="SNK002", name="ขนมครก 5 คู่",
        category="ขนม", external_price=20, internal_price=18,
        vat_percent=0, avg_cost=10.00, stock=40, min_stock=10, photo_url=_snk_photo("Khanom+Krok"))
    upsert_product("canteen_drinks", "avg_cost",
        product_code="SNK003", name="ผลไม้รวม",
        category="ขนม", external_price=25, internal_price=22,
        vat_percent=0, avg_cost=12.00, stock=30, min_stock=10, photo_url=_snk_photo("Fruit"))

    # Canteen items are menu-only — zero out stock/cost on every seed run so
    # legacy rows (and any backend code that still writes these fields) stay
    # consistent with the canteen "no stock" model.
    from sqlalchemy import or_
    from app.models.shop import Shop, ShopProduct
    canteen_ids = [s.id for s in db.query(Shop).filter(Shop.module == "canteen").all()]
    if canteen_ids:
        n = (
            db.query(ShopProduct)
            .filter(
                ShopProduct.shop_id.in_(canteen_ids),
                or_(ShopProduct.stock != 0, ShopProduct.avg_cost != 0, ShopProduct.min_stock != 0),
            )
            .update(
                {"stock": 0, "avg_cost": 0, "min_stock": 0},
                synchronize_session=False,
            )
        )
        if n:
            print(f"  ⚙ Reset stock fields on {n} canteen product(s)")
        db.commit()

    # ── Users (10 accounts — match frontend AuthContext) ───────────────────
    # Personal wallet starter balances — pre-loaded so demo viewers can show
    # POS spending / topup / family transfer flows without first manually
    # topping up. Managers get more headroom to demonstrate sibling/own
    # transfers; cashiers get enough for a few canteen lunches.
    print("\nSeeding users...")
    # Admin
    upsert_user("admin", "admin1234", "Administrator", "admin@isb-coop.local",
                is_superuser=True, role="admin", external_id="PSAD-00001",
                wallet_balance=2000)
    # Managers
    upsert_user("manager_coop",   "manager", "Manager (Coop)",   "manager.coop@isb-coop.local",
                role="manager", external_id="PSMA-00101", shop_id="coop",
                wallet_balance=1500)
    upsert_user("manager_sports", "manager", "Manager (Sports)", "manager.sports@isb-coop.local",
                role="manager", external_id="PSMA-00102", shop_id="sports",
                wallet_balance=1500)
    upsert_user("manager_book",   "manager", "Manager (Book)",   "manager.book@isb-coop.local",
                role="manager", external_id="PSMA-00104", shop_id="bookstore",
                wallet_balance=1500)
    upsert_user("manager_canteen", "manager", "Manager (Canteen)", "manager.canteen@isb-coop.local",
                role="manager", external_id="PSMA-00105", shop_id="canteen",
                wallet_balance=1500)
    # Cashiers
    upsert_user("cashier_coop",   "cashier", "Cashier (Coop)",   "cashier.coop@isb-coop.local",
                role="cashier", external_id="PSCA-00201", shop_id="coop",
                wallet_balance=500)
    upsert_user("cashier_sports", "cashier", "Cashier (Sports)", "cashier.sports@isb-coop.local",
                role="cashier", external_id="PSCA-00202", shop_id="sports",
                wallet_balance=500)
    upsert_user("cashier_book",   "cashier", "Cashier (Book)",   "cashier.book@isb-coop.local",
                role="cashier", external_id="PSCA-00204", shop_id="bookstore",
                wallet_balance=500)
    upsert_user("cashier_canteen", "cashier", "Cashier (Canteen)", "cashier.canteen@isb-coop.local",
                role="cashier", external_id="PSCA-00205", shop_id="canteen",
                wallet_balance=500)
    # Demo canteens (Thai Kitchen + Drinks & Snacks)
    upsert_user("manager_canteen_thai",   "manager", "Manager (Thai Kitchen)",
                "mgr.thai@isb-coop.local", role="manager", external_id="PSMA-00106",
                shop_id="canteen_thai", wallet_balance=1500)
    upsert_user("cashier_canteen_thai",   "cashier", "Cashier (Thai Kitchen)",
                "csh.thai@isb-coop.local", role="cashier", external_id="PSCA-00206",
                shop_id="canteen_thai", wallet_balance=500)
    upsert_user("manager_canteen_drinks", "manager", "Manager (Drinks & Snacks)",
                "mgr.drinks@isb-coop.local", role="manager", external_id="PSMA-00107",
                shop_id="canteen_drinks", wallet_balance=1500)
    upsert_user("cashier_canteen_drinks", "cashier", "Cashier (Drinks & Snacks)",
                "csh.drinks@isb-coop.local", role="cashier", external_id="PSCA-00207",
                shop_id="canteen_drinks", wallet_balance=500)

    # ── Kiosk service account (role=kiosk: read-only customer wallets + search) ──
    kiosk_password = os.getenv("KIOSK_SERVICE_PASSWORD", "kiosk1234")
    upsert_user("kiosk_service", kiosk_password, "Kiosk Service Account",
                "kiosk@isb-coop.local", role="kiosk")
    # Kitchen staff — exercises the new "kitchen" role added to UserRole + sidebar.
    upsert_user("kitchen_canteen_thai", "kitchen", "Kitchen (Thai Kitchen)",
                "kitchen.thai@isb-coop.local", role="kitchen", external_id="PSKI-00301",
                shop_id="canteen_thai", wallet_balance=300)

    db.commit()

    # ── PowerSchool fixture sync: staff/parents/students (Phase 3.5b) ──────
    # Delegates to run_sync() which loads fixtures/ps_staffs.json +
    # fixtures/ps_families.json and upserts users/customers/family_profiles.
    # Using sync_type="full" + disabled RNG fault injection equivalent via
    # deterministic seed — see app.services.powerschool_sync.
    print("\nSyncing PowerSchool fixture (staff + families)...")
    from app.services.powerschool_sync import run_sync
    log = run_sync(db, triggered_by_id=None, sync_type="full",
                   target_roles=["staff", "parent", "student"],
                   fault_rate=0.0)
    print(f"  Sync log #{log.id}: {log.records_success} success / {log.records_failed} failed "
          f"(status={log.status})")
    if log.error_log:
        for line in log.error_log.splitlines()[:5]:
            print(f"    · {line}")

    db.commit()

    # ── Post-sync wallets: pre-load demo balances for PowerSchool parents/staff ──
    # `run_sync()` upserts staff + parent users via its own path (not
    # `upsert_user`) so they don't get the wallet seeding above. Backfill here
    # so demo viewers logging in as a parent see a non-zero own wallet — needed
    # to demonstrate family transfer (parent → child) without a topup detour.
    print("\nSeeding wallets for PowerSchool staff + parent users (demo balances)...")
    from app.models.user import User as _U
    from app.services.wallet_service import WalletService as _WS
    PS_PARENT_DEMO_BALANCE = 1000  # THB — covers a parent → child transfer demo
    PS_STAFF_DEMO_BALANCE = 800     # THB — staff personal lunches at canteen
    n_seeded = 0
    for u in db.query(_U).filter(_U.role.in_(["parent", "staff"]))\
                         .filter(_U.external_id.isnot(None)).all():
        w = _WS.ensure_wallet_for_user(db, u.id)
        if float(w.balance) == 0:
            w.balance = (
                PS_PARENT_DEMO_BALANCE if u.role == "parent" else PS_STAFF_DEMO_BALANCE
            )
            n_seeded += 1
    db.commit()
    if n_seeded:
        print(f"  ↳ pre-loaded {n_seeded} PowerSchool user wallet(s)")

    # ── Demo Visitor / Others / orphan-Student rows (not in PS fixture) ────
    # Shows the full taxonomy (Staff/Parent/Student already seeded via sync)
    # so admin UI + /admin/cards page can demonstrate filtering across all
    # PowerSchool customerType values.
    print("\nSeeding Visitor / Others / orphan demo rows...")
    from app.models.user import User
    from app.models.customer import Customer, CustomerType, CustomerTypeEnum
    from app.models.wallet import Wallet

    internal_ct = db.query(CustomerType).filter(
        CustomerType.type_name == CustomerTypeEnum.INTERNAL
    ).first()
    if not internal_ct:
        internal_ct = CustomerType(
            type_name=CustomerTypeEnum.INTERNAL,
            description="Internal customer",
            default_price_level="internal",
        )
        db.add(internal_ct)
        db.flush()

    VISITOR_ROWS = [
        ("VI046876", "GHISLAIN NTAGANZWASHYAKA", "ntaganzwaghislain23@gmail.com", "VI046876", "A1B2C3D4", 102),
        ("VI045994", "BHURILARP KUMJOHNVIRIYAVANICH", "jeno.mature@gmail.com", "VI045994", "B2C3D4E5", 308),
        ("VI046022", "BOOKSTORE GUEST2", "sumalee020626@gmail.com", "VI046022", "C3D4E5F6", 905),
    ]
    for code, name, email, ext, uid, bal in VISITOR_ROWS:
        if not db.query(Customer).filter(Customer.customer_code == code).first():
            c = Customer(
                customer_code=code, name=name,
                customer_type="Visitor", customer_type_id=internal_ct.id,
                customer_kind="other",
                external_id=ext, card_uid=uid,
                photo_url=_dicebear("visitor", code),
                is_active=True, card_frozen=False,
            )
            db.add(c)
            db.flush()
            db.add(Wallet(customer_id=c.id, balance=bal, is_active=True))
            print(f"  + Visitor: {name} ({code}) · uid={uid} · ฿{bal}")

    ORPHAN_STUDENTS = [
        ("CU-74662", "Chenfei YAN", "24062", "74662", "11", "HS Student", "D4E5F6A7", 0),
        ("CU-74660", "Nihal RAHMAN",  "24060", "74660",  "09", "HS Student", "E5F6A7B8", 0),
        ("CU-74658", "Kuzey KIZILCIK", "24059", "74658", "09", "HS Student", "F6A7B8C9", 0),
    ]
    for code, name, student_code, ext, grade, school_type, uid, bal in ORPHAN_STUDENTS:
        if not db.query(Customer).filter(Customer.customer_code == code).first():
            c = Customer(
                customer_code=code, name=name,
                student_code=student_code, grade=grade, school_type=school_type,
                customer_type="Student", customer_type_id=internal_ct.id,
                customer_kind="student",
                external_id=ext, card_uid=uid,
                photo_url=_dicebear("student", student_code or code),
                is_active=True, card_frozen=False,
            )
            db.add(c)
            db.flush()
            db.add(Wallet(customer_id=c.id, balance=bal, is_active=True))
            print(f"  + Orphan Student (no family_code): {name} ({student_code}) · uid={uid}")

    OTHERS_PARENTS = [
        ("74706@parents.isb.ac.th", "Coralys CEDO", "74706", "74706", "A7B8C9D0"),
        ("74704@parents.isb.ac.th", "Jungho HEO",   "74704", "74704", "B8C9D0E1"),
    ]
    for username, name, ext, family_code, uid in OTHERS_PARENTS:
        if not db.query(User).filter(User.username == username).first():
            u = User(
                username=username,
                email=username,
                hashed_password=get_password_hash("parent"),
                full_name=name,
                is_active=True,
                is_superuser=False,
                role="parent",
                customer_type="Parent",
                external_id=ext,
                family_code=family_code,
                card_uid=uid,
                status="active",
                photo_url=_dicebear("parent", ext),
            )
            db.add(u)
            print(f"  + Others/Parent (no children linked): {name} ({username}) · uid={uid}")

    db.commit()

    # ── Departments (cardholder kind=department, wallet allows negative) ────
    print("\nSeeding demo departments + wallets...")
    from app.models.department import Department as _Dept
    DEPT_DEMO = [
        ("DEPT-ADMIN",   "ฝ่ายธุรการ",       20000),
        ("DEPT-ACADEMIC", "ฝ่ายวิชาการ",     15000),
        ("DEPT-SPORT",   "Sport Department", 10000),
    ]
    for code, name, credit in DEPT_DEMO:
        existing = db.query(_Dept).filter(_Dept.department_code == code).first()
        if not existing:
            dept = _Dept(
                department_code=code,
                department_name=name,
                annual_budget=credit * 12,  # rough headline only
                current_year=datetime.utcnow().year,
                is_active=True,
            )
            db.add(dept)
            db.flush()
            db.add(Wallet(department_id=dept.id, balance=credit, is_active=True))
            print(f"  + Department: {name} ({code}) — credit ฿{credit:,}")

    db.commit()

    # ── Link demo staff users to departments (for card-tap auto-fill) ───────
    print("\nLinking staff users to departments...")
    from app.models.user import User as _U2
    from app.models.department import Department as _Dept2
    STAFF_DEPT_MAP = [
        # (username_or_email_fragment, department_code)
        ("jirawatj@isb.ac.th",   "DEPT-ADMIN"),
        ("angkanan@isb.ac.th",   "DEPT-ADMIN"),
        ("phatthab@isb.ac.th",   "DEPT-ACADEMIC"),
        ("chadb@isb.ac.th",      "DEPT-ACADEMIC"),
    ]
    for login_id, dept_code in STAFF_DEPT_MAP:
        dept = db.query(_Dept2).filter(_Dept2.department_code == dept_code).first()
        if not dept:
            continue
        u = db.query(_U2).filter(_U2.username == login_id).first()
        if u and u.department_id != dept.id:
            u.department_id = dept.id
            print(f"  = {login_id} → {dept_code}")
    db.commit()

    # ── "Other" cardholder demo rows (no card, no wallet by default) ────────
    OTHER_DEMO = [
        ("OTH-CONTRACTOR-001", "ABC Catering Co.", "contact@abccatering.example", "0812345678"),
        ("OTH-VENDOR-001",      "Stationery Vendor", "vendor@example.com", "0823456789"),
    ]
    for code, name, email, phone in OTHER_DEMO:
        if not db.query(Customer).filter(Customer.customer_code == code).first():
            c = Customer(
                customer_code=code, name=name,
                email=email, phone=phone,
                customer_type="Other", customer_type_id=internal_ct.id,
                customer_kind="other",
                photo_url=_dicebear("other", code),
                is_active=True, card_frozen=False,
            )
            db.add(c)
            print(f"  + Other (no card, no wallet): {name} ({code})")

    db.commit()

    print("\n✓ Seed complete.")
    print("\n── Demo accounts (password shown) ─────────────────────")
    print("  admin                    / admin1234   (Admin)")
    print("  manager_coop             / manager     (Coop Shop — FIFO)")
    print("  manager_sports           / manager     (Sports Shop — FIFO)")
    print("  manager_book             / manager     (Bookstore — FIFO)")
    print("  manager_canteen          / manager     (ISB Canteen)")
    print("  manager_canteen_thai     / manager     (Thai Kitchen — 7 menus)")
    print("  manager_canteen_drinks   / manager     (Drinks & Snacks — 8 items)")
    print("  cashier_coop / sports / book / canteen / canteen_thai / canteen_drinks  / cashier")
    print("  PowerSchool staff/parents       / parent   (from fixture)")
    print("    e.g. somchair@isb.ac.th / parent  (Staff + has children)")
    print("    e.g. 85001@parents.isb.ac.th / parent  (John Wick — main parent)")
    print("────────────────────────────────────────────────────────")


HANDOFF_ADMIN_USERNAME = os.getenv("HANDOFF_ADMIN_USERNAME", "admin")
HANDOFF_ADMIN_PASSWORD = os.getenv("HANDOFF_ADMIN_PASSWORD", "admin1234")
HANDOFF_ADMIN_EMAIL = os.getenv("HANDOFF_ADMIN_EMAIL", "admin@isb-coop.local")
HANDOFF_ADMIN_FULL_NAME = os.getenv("HANDOFF_ADMIN_FULL_NAME", "System Administrator")


def seed_handoff():
    """Production handoff: leave ONLY a single admin account.

    All other tables are empty. Customer logs in as admin and creates
    shops/products/users/departments themselves via the admin UI.
    """
    from app.models.user import User

    print("Seeding handoff admin...")
    admin = User(
        username=HANDOFF_ADMIN_USERNAME,
        email=HANDOFF_ADMIN_EMAIL,
        full_name=HANDOFF_ADMIN_FULL_NAME,
        hashed_password=get_password_hash(HANDOFF_ADMIN_PASSWORD),
        role="admin",
        is_superuser=True,
        is_active=True,
        status="active",
        external_id=None,  # never sync-clobbered
    )
    db.add(admin)
    db.commit()
    print(f"  + Admin: {HANDOFF_ADMIN_USERNAME}")
    print("\n✓ Handoff seed complete (admin-only).\n")
    print("── Customer first-login credentials ──")
    print(f"  username: {HANDOFF_ADMIN_USERNAME}")
    print(f"  password: {HANDOFF_ADMIN_PASSWORD}")
    print("  → ลูกค้าควรเปลี่ยน password ทันทีหลัง login ครั้งแรก")
    print("──────────────────────────────────────")


if __name__ == "__main__":
    try:
        if "--handoff" in sys.argv:
            print("⚠ HANDOFF MODE — wiping all data, leaving only admin")
            confirmed = bool(os.getenv("HANDOFF_CONFIRM")) or ("--yes" in sys.argv)
            if not confirmed:
                print("✗ Refusing without explicit confirmation.")
                print("  Set HANDOFF_CONFIRM=1 or pass --yes to proceed.")
                sys.exit(2)
            reset_db()
            seed_handoff()
        elif "--reset" in sys.argv:
            reset_db()
            seed()
        else:
            seed()
    except Exception as e:
        db.rollback()
        print(f"\n✗ Seed failed: {e}")
        raise
    finally:
        db.close()
