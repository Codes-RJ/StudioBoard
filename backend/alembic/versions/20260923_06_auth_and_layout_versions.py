"""add authentication and dashboard layout versions

Revision ID: 20260923_06
Revises: 20260829_05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260923_06"
down_revision: Union[str, Sequence[str], None] = "20260829_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("User", sa.Column("tokenVersion", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("DashboardLayout", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))


def downgrade() -> None:
    op.drop_column("DashboardLayout", "version")
    op.drop_column("User", "tokenVersion")
