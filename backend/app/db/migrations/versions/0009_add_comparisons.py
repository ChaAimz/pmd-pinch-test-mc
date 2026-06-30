"""add comparisons table

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-30

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "comparisons",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sqlmodel.AutoString(), nullable=False),
        sa.Column("description", sqlmodel.AutoString(), nullable=True),
        sa.Column("data", sqlmodel.AutoString(), nullable=False, server_default="{}"),
        sa.Column("created_at", sqlmodel.AutoString(), nullable=False),
        sa.Column("updated_at", sqlmodel.AutoString(), nullable=False),
    )
    op.create_index("ix_comparisons_name", "comparisons", ["name"])


def downgrade():
    op.drop_index("ix_comparisons_name", table_name="comparisons")
    op.drop_table("comparisons")
