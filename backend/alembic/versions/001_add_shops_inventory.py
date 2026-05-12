"""Add shops, shop_products, shop_categories, shop_movements, fifo_lots

Revision ID: 001_add_shops_inventory
Revises:
Create Date: 2026-03-26
"""
from alembic import op
import sqlalchemy as sa

revision = "001_add_shops_inventory"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── shops ─────────────────────────────────────────────────────────────────
    op.create_table(
        "shops",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "shop_type",
            sa.Enum("avg_cost", "fifo", name="shoptype"),
            nullable=False,
            server_default="avg_cost",
        ),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )

    # ── shop_categories ───────────────────────────────────────────────────────
    op.create_table(
        "shop_categories",
        sa.Column("id", sa.String(50), primary_key=True),
        sa.Column("shop_id", sa.String(50), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_shop_categories_shop_id", "shop_categories", ["shop_id"])

    # ── shop_products ─────────────────────────────────────────────────────────
    op.create_table(
        "shop_products",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("shop_id", sa.String(50), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("product_code", sa.String(50), nullable=False),
        sa.Column("barcode", sa.String(100), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(100), nullable=False, server_default="ทั่วไป"),
        sa.Column("external_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("internal_price", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("vat_percent", sa.Numeric(5, 2), nullable=False, server_default="7"),
        sa.Column("avg_cost", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.Column("stock", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("min_stock", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )
    op.create_index("ix_shop_products_shop_id", "shop_products", ["shop_id"])
    op.create_index("ix_shop_products_name", "shop_products", ["name"])
    op.create_index("ix_shop_products_barcode", "shop_products", ["barcode"])

    # ── shop_movements ────────────────────────────────────────────────────────
    op.create_table(
        "shop_movements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column(
            "product_id",
            sa.Integer(),
            sa.ForeignKey("shop_products.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("product_name", sa.String(255), nullable=False),
        sa.Column("shop_id", sa.String(50), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "type",
            sa.Enum("receive", "sale", "adjustment", "internal_use", "void", "exchange", name="movementtype"),
            nullable=False,
        ),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("stock_before", sa.Integer(), nullable=False),
        sa.Column("stock_after", sa.Integer(), nullable=False),
        sa.Column("cost_per_unit", sa.Numeric(10, 4), nullable=True),
        sa.Column("reference", sa.String(100), nullable=True),
        sa.Column("note", sa.String(500), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_shop_movements_shop_id", "shop_movements", ["shop_id"])
    op.create_index("ix_shop_movements_product_id", "shop_movements", ["product_id"])
    op.create_index("ix_shop_movements_date", "shop_movements", ["date"])

    # ── fifo_lots ─────────────────────────────────────────────────────────────
    op.create_table(
        "fifo_lots",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column(
            "product_id",
            sa.Integer(),
            sa.ForeignKey("shop_products.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("shop_id", sa.String(50), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("qty_remaining", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.Column("cost_per_unit", sa.Numeric(10, 4), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_fifo_lots_product_id", "fifo_lots", ["product_id"])
    op.create_index("ix_fifo_lots_shop_id", "fifo_lots", ["shop_id"])


def downgrade() -> None:
    op.drop_table("fifo_lots")
    op.drop_table("shop_movements")
    op.drop_table("shop_products")
    op.drop_table("shop_categories")
    op.drop_table("shops")
    op.execute("DROP TYPE IF EXISTS movementtype")
    op.execute("DROP TYPE IF EXISTS shoptype")
