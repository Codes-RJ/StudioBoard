"""Convert legacy serialized JSON text columns to native JSON columns.

Revision ID: 20260829_02
Revises: 20260829_01
Create Date: 2026-08-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260829_02"
down_revision = "20260829_01"
branch_labels = None
depends_on = None


TARGETS = (
    ("Dataset", "columns", False),
    ("DashboardLayout", "layout", False),
    ("Log", "details", True),
    ("SiteConfig", "value", False),
)


def _is_native_json(table_name: str, column_name: str) -> bool:
    column = next(
        column for column in sa.inspect(op.get_bind()).get_columns(table_name)
        if column["name"] == column_name
    )
    return isinstance(column["type"], sa.JSON)


def upgrade() -> None:
    for table_name, column_name, nullable in TARGETS:
        if _is_native_json(table_name, column_name):
            continue
        with op.batch_alter_table(table_name) as batch:
            batch.alter_column(
                column_name,
                existing_type=sa.Text(),
                type_=sa.JSON(),
                existing_nullable=nullable,
            )


def downgrade() -> None:
    for table_name, column_name, nullable in TARGETS:
        with op.batch_alter_table(table_name) as batch:
            batch.alter_column(
                column_name,
                existing_type=sa.JSON(),
                type_=sa.Text(),
                existing_nullable=nullable,
            )
