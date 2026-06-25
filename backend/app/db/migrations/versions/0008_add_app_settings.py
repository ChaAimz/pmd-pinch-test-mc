"""add app_settings table

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-25

"""
from alembic import op
import sqlalchemy as sa


revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'app_settings',
        sa.Column('id', sa.Integer(), primary_key=True, nullable=False),
        sa.Column('data', sa.Text(), nullable=False, server_default='{}'),
    )


def downgrade():
    op.drop_table('app_settings')
