"""add peak_clamp_n to test_loops

Revision ID: c1b3280fe8de
Revises: 0006
Create Date: 2026-06-25 10:08:37.397393

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel


revision = 'c1b3280fe8de'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('test_loops', sa.Column('peak_clamp_n', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('test_loops', 'peak_clamp_n')
