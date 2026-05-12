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

# Force DEBUG off before importing app modules so SQLAlchemy doesn't echo.
os.environ["DEBUG"] = "false"

from sqlalchemy.pool import StaticPool  # noqa: E402

from app.core import database as db_module  # noqa: E402
from app.core.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, get_password_hash  # noqa: E402
from app.main import app  # noqa: E402
from app.models.shop import Shop  # noqa: E402
from app.models.user import User  # noqa: E402


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
    Base.metadata.create_all(bind=engine, tables=needed_tables)
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


def _token_for(user: User) -> str:
    return create_access_token({"sub": str(user.id), "email": user.email})


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
    }
