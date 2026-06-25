"""add prepare_timer_s to recipes — sent to PLC DM40 (sec × 10) during prepare step

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("recipes") as batch_op:
        batch_op.add_column(
            sa.Column("prepare_timer_s", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade():
    with op.batch_alter_table("recipes") as batch_op:
        batch_op.drop_column("prepare_timer_s")
