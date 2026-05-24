"""Add cash_received column to receipts so cash-payment receipts can show
the tendered amount and change due in receipt detail views.

Nullable so non-cash receipts (wallet/QR/EDC/department) leave it NULL
and the column is backwards-compatible with existing rows.

Revision ID: 006_receipt_cash_received
Revises: 005_audit_action_enum_values
Create Date: 2026-05-25
"""
from alembic import op
import sqlalchemy as sa

revision = "006_receipt_cash_received"
down_revision = "005_audit_action_enum_values"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "receipts",
        sa.Column("cash_received", sa.Numeric(10, 2), nullable=True),
    )


def downgrade():
    op.drop_column("receipts", "cash_received")
