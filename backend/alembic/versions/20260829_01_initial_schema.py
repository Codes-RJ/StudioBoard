"""Create the initial Analytics Dashboard schema.

Revision ID: 20260829_01
Revises:
Create Date: 2026-08-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260829_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "User",
        sa.Column("id", sa.String(length=191), nullable=False),
        sa.Column("email", sa.String(length=191), nullable=False),
        sa.Column("password", sa.String(length=191), nullable=False),
        sa.Column("name", sa.String(length=191), nullable=True),
        sa.Column("role", sa.String(length=50), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
    )
    op.create_index("ix_User_email", "User", ["email"], unique=False)

    op.create_table(
        "Dataset",
        sa.Column("id", sa.String(length=191), nullable=False),
        sa.Column("name", sa.String(length=191), nullable=False),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column("fileName", sa.String(length=191), nullable=False),
        sa.Column("filePath", sa.String(length=500), nullable=False),
        sa.Column("rowCount", sa.Integer(), nullable=False),
        sa.Column("columns", sa.JSON(), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("userId", sa.String(length=191), nullable=False),
        sa.ForeignKeyConstraint(["userId"], ["User.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_Dataset_createdAt", "Dataset", ["createdAt"], unique=False)
    op.create_index("ix_Dataset_userId", "Dataset", ["userId"], unique=False)
    op.create_index("ix_dataset_user_created", "Dataset", ["userId", "createdAt"], unique=False)

    op.create_table(
        "DashboardLayout",
        sa.Column("id", sa.String(length=191), nullable=False),
        sa.Column("name", sa.String(length=191), nullable=False),
        sa.Column("layout", sa.JSON(), nullable=False),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("userId", sa.String(length=191), nullable=False),
        sa.ForeignKeyConstraint(["userId"], ["User.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_DashboardLayout_userId", "DashboardLayout", ["userId"], unique=False)
    op.create_index("ix_dashboard_layout_user_created", "DashboardLayout", ["userId", "createdAt"], unique=False)

    op.create_table(
        "Log",
        sa.Column("id", sa.String(length=191), nullable=False),
        sa.Column("action", sa.String(length=191), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("createdAt", sa.DateTime(timezone=True), nullable=False),
        sa.Column("userId", sa.String(length=191), nullable=True),
        sa.Column("datasetId", sa.String(length=191), nullable=True),
        sa.ForeignKeyConstraint(["datasetId"], ["Dataset.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["userId"], ["User.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_Log_createdAt", "Log", ["createdAt"], unique=False)
    op.create_index("ix_Log_datasetId", "Log", ["datasetId"], unique=False)
    op.create_index("ix_Log_userId", "Log", ["userId"], unique=False)

    op.create_table(
        "SiteConfig",
        sa.Column("id", sa.String(length=191), nullable=False),
        sa.Column("key", sa.String(length=191), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updatedAt", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("key"),
    )
    op.create_index("ix_SiteConfig_key", "SiteConfig", ["key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_SiteConfig_key", table_name="SiteConfig")
    op.drop_table("SiteConfig")
    op.drop_index("ix_Log_userId", table_name="Log")
    op.drop_index("ix_Log_datasetId", table_name="Log")
    op.drop_index("ix_Log_createdAt", table_name="Log")
    op.drop_table("Log")
    op.drop_index("ix_dashboard_layout_user_created", table_name="DashboardLayout")
    op.drop_index("ix_DashboardLayout_userId", table_name="DashboardLayout")
    op.drop_table("DashboardLayout")
    op.drop_index("ix_dataset_user_created", table_name="Dataset")
    op.drop_index("ix_Dataset_userId", table_name="Dataset")
    op.drop_index("ix_Dataset_createdAt", table_name="Dataset")
    op.drop_table("Dataset")
    op.drop_index("ix_User_email", table_name="User")
    op.drop_table("User")
