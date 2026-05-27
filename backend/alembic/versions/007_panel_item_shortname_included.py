"""add short_name and included to price_panel_items

Revision ID: 007_panel_item_shortname_included
Revises: 006_receipt_cash_received
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa

revision = '007_panel_item_shortname_included'
down_revision = '006_receipt_cash_received'
branch_labels = None
depends_on = None

def upgrade():
    op.add_column('price_panel_items', sa.Column('short_name', sa.String(100), nullable=True))
    op.add_column('price_panel_items', sa.Column('included', sa.Boolean(), nullable=False, server_default=sa.true()))

def downgrade():
    op.drop_column('price_panel_items', 'included')
    op.drop_column('price_panel_items', 'short_name')
