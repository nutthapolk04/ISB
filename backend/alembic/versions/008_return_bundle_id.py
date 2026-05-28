"""add bundle_id to return_requests for bundle-aware refunds

Revision ID: 008_return_bundle_id
Revises: 007_panel_shortname
Create Date: 2026-05-29
"""
from alembic import op
import sqlalchemy as sa

revision = '008_return_bundle'
down_revision = '007_panel_shortname'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('return_requests', sa.Column('bundle_id', sa.Integer(), nullable=True))
    op.create_index('ix_return_requests_bundle_id', 'return_requests', ['bundle_id'])


def downgrade():
    op.drop_index('ix_return_requests_bundle_id', table_name='return_requests')
    op.drop_column('return_requests', 'bundle_id')
