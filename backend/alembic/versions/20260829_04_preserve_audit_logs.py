"""Preserve audit logs when a dataset is deleted.

Revision ID: 20260829_04
Revises: 20260829_03
Create Date: 2026-08-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260829_04"
down_revision = "20260829_03"
branch_labels = None
depends_on = None


def _dataset_foreign_key():
    foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys("Log")
    return next(
        (
            foreign_key for foreign_key in foreign_keys
            if foreign_key["constrained_columns"] == ["datasetId"]
        ),
        None,
    )


def upgrade() -> None:
    bind = op.get_bind()
    # The new baseline already has SET NULL. SQLite's unnamed constraints are
    # recreated by batch migrations, so only alter the legacy MySQL topology.
    if bind.dialect.name != "mysql":
        return
    foreign_key = _dataset_foreign_key()
    if not foreign_key or foreign_key.get("options", {}).get("ondelete", "").upper() == "SET NULL":
        return
    op.drop_constraint(foreign_key["name"], "Log", type_="foreignkey")
    op.create_foreign_key(
        foreign_key["name"],
        "Log",
        "Dataset",
        ["datasetId"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    foreign_key = _dataset_foreign_key()
    if not foreign_key or foreign_key.get("options", {}).get("ondelete", "").upper() == "CASCADE":
        return
    op.drop_constraint(foreign_key["name"], "Log", type_="foreignkey")
    op.create_foreign_key(
        foreign_key["name"],
        "Log",
        "Dataset",
        ["datasetId"],
        ["id"],
        ondelete="CASCADE",
    )
