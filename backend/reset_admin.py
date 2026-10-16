"""Destructively replace every application user with one configured administrator."""

import argparse
import asyncio
import os
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import Base
from app.core.security import hash_password
from app.domain.models import Dataset, User


def read_admin_credentials() -> tuple[str, str, str]:
    email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
    password = os.environ.get("ADMIN_PASSWORD", "")
    name = os.environ.get("ADMIN_NAME", "Administrator").strip() or "Administrator"

    if "@" not in email or len(password) < 12:
        raise RuntimeError(
            "Set ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters before resetting users."
        )
    return email, password, name[:191]


async def reset_users(confirm: bool) -> None:
    email, password, name = read_admin_credentials()
    engine = create_async_engine(settings.async_database_url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async with session_factory() as session:
            result = await session.execute(
                select(User).options(
                    selectinload(User.datasets).selectinload(Dataset.logs),
                    selectinload(User.dashboardLayouts),
                    selectinload(User.logs),
                )
            )
            users = list(result.scalars().unique().all())
            file_paths = [dataset.filePath for user in users for dataset in user.datasets if dataset.filePath]

            if not confirm:
                print(f"Dry run: {len(users)} users and {len(file_paths)} uploaded files would be removed.")
                return

            for user in users:
                await session.delete(user)

            session.add(User(email=email, password=hash_password(password), name=name, role="ADMIN"))
            await session.commit()

        for file_path in file_paths:
            try:
                Path(file_path).unlink(missing_ok=True)
            except OSError:
                print(f"Warning: could not remove uploaded file: {file_path}")

        print(f"Reset complete. The only account is administrator {email}.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Replace every application user with one administrator.")
    parser.add_argument("--confirm", action="store_true", help="perform the destructive reset")
    args = parser.parse_args()
    asyncio.run(reset_users(args.confirm))
