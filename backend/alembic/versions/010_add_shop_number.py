"""add shop_number to shops for receipt number format

Revision ID: 010_add_shop_number
Revises: 009_payment_intent_txn_no
Create Date: 2026-06-26
"""
from alembic import op
import sqlalchemy as sa

revision = '010_add_shop_number'
down_revision = '009_payment_intent_txn_no'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shops", sa.Column("shop_number", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("shops", "shop_number")
