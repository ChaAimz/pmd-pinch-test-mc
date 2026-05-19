"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-05-19
"""
from alembic import op
import sqlalchemy as sa
import sqlmodel

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "recipes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sqlmodel.AutoString(), nullable=False, unique=True),
        sa.Column("description", sqlmodel.AutoString(), nullable=True),
        sa.Column("position_mm", sa.Float(), nullable=False),
        sa.Column("speed_mms", sa.Float(), nullable=False),
        sa.Column("clamp_threshold_n", sa.Float(), nullable=False),
        sa.Column("loop_count", sa.Integer(), nullable=False),
        sa.Column("min_force_n", sa.Float(), nullable=True),
        sa.Column("max_force_n", sa.Float(), nullable=True),
        sa.Column("hold_time_ms", sa.Integer(), nullable=True),
        sa.Column("sampling_hz", sa.Integer(), nullable=False),
        sa.Column("created_at", sqlmodel.AutoString(), nullable=False),
        sa.Column("updated_at", sqlmodel.AutoString(), nullable=False),
    )
    op.create_index("ix_recipes_name", "recipes", ["name"], unique=True)

    op.create_table(
        "test_runs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("recipe_id", sa.Integer(), sa.ForeignKey("recipes.id"), nullable=False),
        sa.Column("operator", sqlmodel.AutoString(), nullable=True),
        sa.Column("batch_id", sqlmodel.AutoString(), nullable=True),
        sa.Column("shift", sqlmodel.AutoString(), nullable=True),
        sa.Column("started_at", sqlmodel.AutoString(), nullable=False),
        sa.Column("finished_at", sqlmodel.AutoString(), nullable=True),
        sa.Column("status", sqlmodel.AutoString(), nullable=False),
        sa.Column("abort_reason", sqlmodel.AutoString(), nullable=True),
        sa.Column("loops_completed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("waveform_dir", sqlmodel.AutoString(), nullable=True),
    )
    op.create_index("ix_runs_started", "test_runs", ["started_at"])
    op.create_index("ix_runs_recipe_id", "test_runs", ["recipe_id"])

    op.create_table(
        "test_loops",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("run_id", sa.Integer(), sa.ForeignKey("test_runs.id"), nullable=False),
        sa.Column("loop_index", sa.Integer(), nullable=False),
        sa.Column("started_at", sqlmodel.AutoString(), nullable=False),
        sa.Column("finished_at", sqlmodel.AutoString(), nullable=True),
        sa.Column("peak_force_n", sa.Float(), nullable=True),
        sa.Column("avg_force_n", sa.Float(), nullable=True),
        sa.Column("hold_time_ms", sa.Integer(), nullable=True),
        sa.Column("judgment", sqlmodel.AutoString(), nullable=True),
        sa.Column("waveform_file", sqlmodel.AutoString(), nullable=True),
    )
    op.create_index("ix_loops_run", "test_loops", ["run_id", "loop_index"])


def downgrade():
    op.drop_index("ix_loops_run", table_name="test_loops")
    op.drop_table("test_loops")
    op.drop_index("ix_runs_started", table_name="test_runs")
    op.drop_index("ix_runs_recipe_id", table_name="test_runs")
    op.drop_table("test_runs")
    op.drop_index("ix_recipes_name", table_name="recipes")
    op.drop_table("recipes")
