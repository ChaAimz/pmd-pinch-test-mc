"""drop hold_time_ms from recipes — PLC controls all timing via MR805/MR806/MR807

Revision ID: 0002
Revises: 0001
Create Date: 2026-05-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    # SQLite requires batch_alter_table to drop a column.
    with op.batch_alter_table("recipes") as batch_op:
        batch_op.drop_column("hold_time_ms")


def downgrade():
    with op.batch_alter_table("recipes") as batch_op:
        batch_op.add_column(sa.Column("hold_time_ms", sa.Integer(), nullable=True))
