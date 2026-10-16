"""Add renewable per-attempt job lease expiration.

Revision ID: 20261009_07
Revises: 20260923_06
"""

from alembic import op
import sqlalchemy as sa

revision = "20261009_07"
down_revision = "20260923_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing running rows retain the startedAt-based recovery fallback.
    op.add_column("AnalyticsJob", sa.Column("leaseExpiresAt", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("AnalyticsJob", "leaseExpiresAt")
