"""
Test fixtures for the backend test suite.

Builds an isolated in-memory SQLite database for each test, overrides the
FastAPI `get_db` dependency and seeds three reference users (admin / shop-
manager / cashier) plus a couple of Shop rows for scoping.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Make sure the backend package is importable regardless of the invocation
# directory (e.g. `pytest` from repo root).
BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

# Force DEBUG off and use an in-memory SQLite URL so that importing app.main
# does NOT attempt to connect to Postgres or call create_all against a live DB.
os.environ["DEBUG"] = "false"
os.environ.setdefault("DATABASE_URL", "sqlite://")

from sqlalchemy.pool import StaticPool  # noqa: E402
from unittest.mock import patch as _patch  # noqa: E402

# Prevent main.py's top-level Base.metadata.create_all(engine) from running
# against whatever engine is configured — conftest fixtures manage schema creation.
import sqlalchemy  # noqa: E402
_real_create_engine = sqlalchemy.create_engine

_POSTGRES_ONLY_KWARGS = {"pool_size", "max_overflow", "pool_timeout", "pool_recycle", "pool_pre_ping"}

def _sqlite_create_engine(url, **kw):
    """Redirect any postgres:// URL to an in-memory SQLite for testing."""
    if isinstance(url, str) and (url.startswith("postgresql") or url == "sqlite://"):
        url = "sqlite://"
        for k in _POSTGRES_ONLY_KWARGS:
            kw.pop(k, None)
        kw["connect_args"] = {"check_same_thread": False}
        kw["poolclass"] = StaticPool
    return _real_create_engine(url, **kw)

sqlalchemy.create_engine = _sqlite_create_engine  # patch before any app import

# Suppress the top-level Base.metadata.create_all(engine) call in main.py.
# Each fixture manages its own schema via targeted create_all on selected tables.
import unittest.mock as _mock  # noqa: E402

from app.core import database as db_module  # noqa: E402
from app.core.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402

with _mock.patch.object(Base.metadata, "create_all", lambda *a, **kw: None):
    from app.main import app  # noqa: E402 — import while create_all is suppressed
from sqlalchemy import CheckConstraint as _CheckConstraint  # noqa: E402
from app.models.shop import Shop, ShopProduct, ShopMovement, MovementType  # noqa: E402
from app.models.user import User  # noqa: E402


def _create_tables_sqlite(engine, tables: list) -> None:
    """Create tables on a SQLite engine, temporarily stripping Postgres-specific
    CheckConstraints (e.g. the `::int` cast in wallets.chk_wallet_owner) that
    SQLite cannot parse."""
    stripped: list[tuple] = []
    for table in tables:
        pg_checks = [
            c for c in list(table.constraints)
            if isinstance(c, _CheckConstraint) and "::" in str(c.sqltext)
        ]
        for c in pg_checks:
            table.constraints.discard(c)
            stripped.append((table, c))

    Base.metadata.create_all(bind=engine, tables=tables)

    for table, c in stripped:
        table.constraints.add(c)


@pytest.fixture()
def db_session() -> Generator:
    """Create a fresh in-memory SQLite DB per test."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(
        autocommit=False, autoflush=False, bind=engine
    )

    # Swap the global engine so Base.metadata.create_all runs against SQLite.
    original_engine = db_module.engine
    original_session_local = db_module.SessionLocal
    db_module.engine = engine
    db_module.SessionLocal = TestingSessionLocal

    # Only build the tables this API actually touches — the full metadata
    # includes Postgres-specific types (JSONB, etc.) that SQLite can't compile.
    needed_tables = [
        Base.metadata.tables[name]
        for name in (
            "shops", "users", "roles", "permissions", "user_roles", "role_permissions",
            # Extended for negative-balance guard tests:
            "customer_types", "customers",
            "wallets", "wallet_transactions",
            "departments",
            "parent_child_links",
            "system_settings",
        )
        if name in Base.metadata.tables
    ]
    _create_tables_sqlite(engine, needed_tables)
    session = TestingSessionLocal()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=needed_tables)
        db_module.engine = original_engine
        db_module.SessionLocal = original_session_local


@pytest.fixture()
def client(db_session) -> Generator[TestClient, None, None]:
    """TestClient with the `get_db` dependency swapped to the fixture session."""

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── Seed helpers ─────────────────────────────────────────────────────────────


def _token_for(user: User, session_token: str | None = None) -> str:
    return create_access_token(
        {"sub": str(user.id), "email": user.email},
        session_token=session_token,
    )


@pytest.fixture()
def seeded(db_session):
    """Seed two shops and admin/manager/cashier users. Returns a bundle."""
    coop = Shop(id="coop", name="Coop Store", shop_type="avg_cost")
    canteen = Shop(id="canteen", name="Canteen", shop_type="avg_cost")
    db_session.add_all([coop, canteen])
    db_session.flush()

    admin = User(
        username="admin",
        email="admin@isb-coop.local",
        full_name="Admin User",
        hashed_password=get_password_hash("admin123"),
        role="admin",
        is_active=True,
        is_superuser=True,
        status="active",
    )
    coop_manager = User(
        username="coop_mgr",
        email="coop_mgr@isb-coop.local",
        full_name="Coop Manager",
        hashed_password=get_password_hash("manager123"),
        role="manager",
        is_active=True,
        is_superuser=False,
        shop_id="coop",
        status="active",
    )
    canteen_manager = User(
        username="canteen_mgr",
        email="canteen_mgr@isb-coop.local",
        full_name="Canteen Manager",
        hashed_password=get_password_hash("manager123"),
        role="manager",
        is_active=True,
        is_superuser=False,
        shop_id="canteen",
        status="active",
    )
    coop_cashier = User(
        username="coop_cashier",
        email="coop_cashier@isb-coop.local",
        full_name="Coop Cashier",
        hashed_password=get_password_hash("cashier123"),
        role="cashier",
        is_active=True,
        is_superuser=False,
        shop_id="coop",
        status="active",
    )
    canteen_cashier = User(
        username="canteen_cashier",
        email="canteen_cashier@isb-coop.local",
        full_name="Canteen Cashier",
        hashed_password=get_password_hash("cashier123"),
        role="cashier",
        is_active=True,
        is_superuser=False,
        shop_id="canteen",
        status="active",
    )
    db_session.add_all([admin, coop_manager, canteen_manager, coop_cashier, canteen_cashier])
    db_session.commit()
    for u in (admin, coop_manager, canteen_manager, coop_cashier, canteen_cashier):
        db_session.refresh(u)

    return {
        "admin": admin,
        "coop_manager": coop_manager,
        "canteen_manager": canteen_manager,
        "coop_cashier": coop_cashier,
        "canteen_cashier": canteen_cashier,
        "admin_headers": {"Authorization": f"Bearer {_token_for(admin)}"},
        "coop_mgr_headers": {"Authorization": f"Bearer {_token_for(coop_manager)}"},
        "canteen_mgr_headers": {
            "Authorization": f"Bearer {_token_for(canteen_manager)}"
        },
        "coop_cashier_headers": {
            "Authorization": f"Bearer {_token_for(coop_cashier)}"
        },
        "_token_for": _token_for,  # expose helper for session-token tests
    }


# ── POS / shop / stock fixtures ───────────────────────────────────────────────

POS_TABLES = (
    "shops", "users", "roles", "permissions", "user_roles", "role_permissions",
    "customer_types", "customers", "departments", "parent_child_links",
    "wallets", "wallet_transactions", "payment_intents",
    "system_settings",
    "shop_categories", "shop_products", "shop_movements",
    "menu_option_groups", "menu_options",
    "product_bundles", "bundle_items",
    "receipts", "receipt_items",
    "fifo_lots",
)


@pytest.fixture()
def db_session_pos() -> Generator:
    """In-memory SQLite DB with all POS / shop / stock tables."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    original_engine = db_module.engine
    original_session_local = db_module.SessionLocal
    db_module.engine = engine
    db_module.SessionLocal = TestingSessionLocal

    tables = [
        Base.metadata.tables[name]
        for name in POS_TABLES
        if name in Base.metadata.tables
    ]
    _create_tables_sqlite(engine, tables)
    session = TestingSessionLocal()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=tables)
        db_module.engine = original_engine
        db_module.SessionLocal = original_session_local


@pytest.fixture()
def client_pos(db_session_pos) -> Generator[TestClient, None, None]:
    """TestClient wired to the POS db_session_pos fixture."""
    def _override():
        try:
            yield db_session_pos
        finally:
            pass

    app.dependency_overrides[get_db] = _override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture()
def pos_seed(db_session_pos):
    """Seed one shop, admin user, and 3 ShopProducts with stock."""
    from app.models.shop import Shop, ShopProduct
    from decimal import Decimal

    shop = Shop(id="coop", name="Coop", shop_type="avg_cost", is_active=True)
    db_session_pos.add(shop)
    db_session_pos.flush()

    admin = User(
        username="admin",
        email="admin@test.local",
        full_name="Admin",
        hashed_password=get_password_hash("admin123"),
        role="admin",
        is_active=True,
        is_superuser=True,
        status="active",
    )
    db_session_pos.add(admin)
    db_session_pos.flush()

    p1 = ShopProduct(shop_id="coop", product_code="NB001", name="Notebook", external_price=Decimal("50"), stock=100, is_active=True)
    p2 = ShopProduct(shop_id="coop", product_code="PC001", name="Pencil",   external_price=Decimal("10"), stock=200, is_active=True)
    p3 = ShopProduct(shop_id="coop", product_code="ER001", name="Eraser",   external_price=Decimal("5"),  stock=150, is_active=True)
    db_session_pos.add_all([p1, p2, p3])
    db_session_pos.commit()
    for obj in (admin, p1, p2, p3):
        db_session_pos.refresh(obj)

    return {"admin": admin, "shop": shop, "p1": p1, "p2": p2, "p3": p3}
