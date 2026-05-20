"""Add missing auditaction enum values (UPDATE_PRICE, UPDATE_PRODUCT, DELETE_PRODUCT, etc.)

Revision ID: 005_audit_action_enum_values
Revises: 004_user_shop_module
Create Date: 2026-05-21
"""
from alembic import op

revision = "005_audit_action_enum_values"
down_revision = "004_user_shop_module"
branch_labels = None
depends_on = None

NEW_VALUES = [
    "UPDATE_PRICE",
    "UPDATE_PRODUCT",
    "DELETE_PRODUCT",
    "UPDATE_BALANCE",
    "UPDATE_SETTING",
]


def upgrade():
    # PostgreSQL requires committing the transaction before ALTER TYPE ADD VALUE
    op.execute("COMMIT")
    for value in NEW_VALUES:
        op.execute(
            f"ALTER TYPE auditaction ADD VALUE IF NOT EXISTS '{value}'"
        )


def downgrade():
    # PostgreSQL does not support removing enum values — downgrade is a no-op
    pass
