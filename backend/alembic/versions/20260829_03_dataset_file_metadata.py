"""Add file provenance metadata to datasets.

Revision ID: 20260829_03
Revises: 20260829_02
Create Date: 2026-08-29
"""

from alembic import op
import sqlalchemy as sa


revision = "20260829_03"
down_revision = "20260829_02"
branch_labels = None
depends_on = None


def _column_names(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def upgrade() -> None:
    existing = _column_names("Dataset")
    with op.batch_alter_table("Dataset") as batch:
        if "fileSize" not in existing:
            batch.add_column(sa.Column("fileSize", sa.Integer(), nullable=False, server_default="0"))
        if "mimeType" not in existing:
            batch.add_column(sa.Column("mimeType", sa.String(length=191), nullable=True))
        if "checksum" not in existing:
            batch.add_column(sa.Column("checksum", sa.String(length=64), nullable=True))
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("Dataset")}
    if "ix_Dataset_checksum" not in indexes:
        op.create_index("ix_Dataset_checksum", "Dataset", ["checksum"], unique=False)


def downgrade() -> None:
    indexes = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("Dataset")}
    if "ix_Dataset_checksum" in indexes:
        op.drop_index("ix_Dataset_checksum", table_name="Dataset")
    with op.batch_alter_table("Dataset") as batch:
        batch.drop_column("checksum")
        batch.drop_column("mimeType")
        batch.drop_column("fileSize")
