"""Add durable analytics job queue.

Revision ID: 20260829_05
Revises: 20260829_04
Create Date: 2026-08-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260829_05"
down_revision = "20260829_04"
branch_labels = None
depends_on = None


def _referenced_id_type(table_name: str) -> sa.String:
    """Match a pre-existing key's length and collation for MySQL foreign keys."""
    column = next(
        column
        for column in sa.inspect(op.get_bind()).get_columns(table_name)
        if column["name"] == "id"
    )
    column_type = column["type"]
    return sa.String(
        length=getattr(column_type, "length", None) or 191,
        collation=getattr(column_type, "collation", None),
    )


def upgrade() -> None:
    user_id_type = _referenced_id_type("User")
    dataset_id_type = _referenced_id_type("Dataset")

    op.create_table(
        "AnalyticsJob",
        sa.Column("id", sa.String(length=191), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("strategy", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("parameters", sa.JSON(), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.String(length=1000), nullable=True),
        sa.Column("outputPath", sa.String(length=500), nullable=True),
        sa.Column("outputMimeType", sa.String(length=191), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("startedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completedAt", sa.DateTime(timezone=True), nullable=True),
        sa.Column("userId", user_id_type, nullable=False),
        sa.Column("datasetId", dataset_id_type, nullable=True),
        sa.ForeignKeyConstraint(["datasetId"], ["Dataset.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["userId"], ["User.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_AnalyticsJob_createdAt", "AnalyticsJob", ["createdAt"], unique=False)
    op.create_index("ix_AnalyticsJob_datasetId", "AnalyticsJob", ["datasetId"], unique=False)
    op.create_index("ix_AnalyticsJob_userId", "AnalyticsJob", ["userId"], unique=False)
    op.create_index("ix_analytics_job_status_created", "AnalyticsJob", ["status", "createdAt"], unique=False)
    op.create_index("ix_analytics_job_user_created", "AnalyticsJob", ["userId", "createdAt"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_analytics_job_user_created", table_name="AnalyticsJob")
    op.drop_index("ix_analytics_job_status_created", table_name="AnalyticsJob")
    op.drop_index("ix_AnalyticsJob_userId", table_name="AnalyticsJob")
    op.drop_index("ix_AnalyticsJob_datasetId", table_name="AnalyticsJob")
    op.drop_index("ix_AnalyticsJob_createdAt", table_name="AnalyticsJob")
    op.drop_table("AnalyticsJob")
