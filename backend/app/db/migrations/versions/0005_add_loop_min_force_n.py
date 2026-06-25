"""add min_force_n to test_loops

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("test_loops", sa.Column("min_force_n", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("test_loops", "min_force_n")
