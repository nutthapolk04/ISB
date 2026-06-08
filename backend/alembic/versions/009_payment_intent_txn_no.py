"""add txn_no to payment_intents for BAY/PYMT gateway tracking

Revision ID: 009_payment_intent_txn_no
Revises: 008_return_bundle
Create Date: 2026-06-08
"""
from alembic import op
import sqlalchemy as sa

revision = '009_payment_intent_txn_no'
down_revision = '008_return_bundle'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('payment_intents', sa.Column('txn_no', sa.String(100), nullable=True))
    op.create_index('ix_payment_intents_txn_no', 'payment_intents', ['txn_no'])


def downgrade():
    op.drop_index('ix_payment_intents_txn_no', table_name='payment_intents')
    op.drop_column('payment_intents', 'txn_no')
