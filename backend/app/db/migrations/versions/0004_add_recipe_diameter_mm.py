"""add diameter_mm to recipes — sent to PLC DM36 (mm × 100) as OD value

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("recipes") as batch_op:
        batch_op.add_column(
            sa.Column("diameter_mm", sa.Float(), nullable=False, server_default="0")
        )


def downgrade():
    with op.batch_alter_table("recipes") as batch_op:
        batch_op.drop_column("diameter_mm")
