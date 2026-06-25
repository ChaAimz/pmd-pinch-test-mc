"""add tension_end_ms to test_loops

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("test_loops", sa.Column("tension_end_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("test_loops", "tension_end_ms")
