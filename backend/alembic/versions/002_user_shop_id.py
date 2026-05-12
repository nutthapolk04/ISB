"""Add shop_id foreign-key column to users

Revision ID: 002_user_shop_id
Revises: 001_add_shops_inventory
Create Date: 2026-04-21
"""
from alembic import op
import sqlalchemy as sa

revision = "002_user_shop_id"
down_revision = "001_add_shops_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("shop_id", sa.String(50), nullable=True),
    )
    op.create_foreign_key(
        "fk_users_shop_id",
        "users",
        "shops",
        ["shop_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_users_shop_id", "users", ["shop_id"])


def downgrade() -> None:
    op.drop_index("ix_users_shop_id", table_name="users")
    op.drop_constraint("fk_users_shop_id", "users", type_="foreignkey")
    op.drop_column("users", "shop_id")
