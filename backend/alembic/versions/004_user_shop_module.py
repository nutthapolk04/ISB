"""Add shop_module to users

Revision ID: 004_user_shop_module
Revises: 003_cafeteria_to_canteen
Create Date: 2026-05-14
"""
from alembic import op
import sqlalchemy as sa

revision = "004_user_shop_module"
down_revision = "003_cafeteria_to_canteen"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("shop_module", sa.String(20), nullable=True))


def downgrade():
    op.drop_column("users", "shop_module")
