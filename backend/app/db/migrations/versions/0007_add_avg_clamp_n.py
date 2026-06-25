"""add avg_clamp_n to test_loops

Revision ID: 0007
Revises: c1b3280fe8de
Create Date: 2026-06-25

"""
from alembic import op
import sqlalchemy as sa


revision = '0007'
down_revision = 'c1b3280fe8de'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('test_loops', sa.Column('avg_clamp_n', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('test_loops', 'avg_clamp_n')
