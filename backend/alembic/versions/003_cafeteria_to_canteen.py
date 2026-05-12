"""Merge cafeteria shop into canteen, delete cafeteria.

Revision ID: 003_cafeteria_to_canteen
Revises: 002_user_shop_id
Create Date: 2026-04-22
"""
from alembic import op
import sqlalchemy as sa

revision = "003_cafeteria_to_canteen"
down_revision = "002_user_shop_id"
branch_labels = None
depends_on = None


def _has_shop_id_column(conn, table_name: str) -> bool:
    """Return True iff <table>.shop_id exists in the current database."""
    return conn.execute(
        sa.text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = 'shop_id'"
        ),
        {"t": table_name},
    ).first() is not None


def upgrade() -> None:
    # Idempotent: only act if cafeteria row exists
    conn = op.get_bind()
    exists = conn.execute(sa.text("SELECT 1 FROM shops WHERE id='cafeteria'")).first()
    if not exists:
        return

    # Ensure canteen shop exists (create minimal row if not — production safety)
    canteen_exists = conn.execute(sa.text("SELECT 1 FROM shops WHERE id='canteen'")).first()
    if not canteen_exists:
        conn.execute(sa.text("""
            INSERT INTO shops (id, name, shop_type, description, is_active)
            VALUES ('canteen', 'ISB Canteen', 'avg_cost', 'Tablet canteen POS', true)
        """))

    # Move all FK references (every table with shop_id FK).
    # Each UPDATE is guarded by a column-exists check so the migration works
    # even if a table's shop_id column hasn't been added yet in this env
    # (e.g. receipts.shop_id is declared on the model but has no migration).
    tables_with_shop_id = [
        "shop_products",
        "shop_categories",
        "shop_movements",
        "fifo_lots",
        "receipts",
        "users",
    ]
    for table in tables_with_shop_id:
        if not _has_shop_id_column(conn, table):
            continue
        conn.execute(
            sa.text(f"UPDATE {table} SET shop_id='canteen' WHERE shop_id='cafeteria'")
        )

    # Finally drop cafeteria shop
    conn.execute(sa.text("DELETE FROM shops WHERE id='cafeteria'"))


def downgrade() -> None:
    # Best-effort: recreate cafeteria shell. Data cannot be perfectly split back.
    conn = op.get_bind()
    exists = conn.execute(sa.text("SELECT 1 FROM shops WHERE id='cafeteria'")).first()
    if not exists:
        conn.execute(sa.text("""
            INSERT INTO shops (id, name, shop_type, description, is_active)
            VALUES ('cafeteria', 'Cafeteria (restored)', 'avg_cost', 'Restored by downgrade', true)
        """))
