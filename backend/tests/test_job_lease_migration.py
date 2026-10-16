import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def test_job_lease_migration_preserves_existing_rows_and_round_trips(tmp_path):
    path = Path(__file__).parents[1] / "alembic/versions/20261009_07_job_leases.py"
    spec = importlib.util.spec_from_file_location("job_lease_migration", path)
    migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    try:
        with engine.begin() as connection:
            connection.execute(text('CREATE TABLE "AnalyticsJob" (id VARCHAR(191) PRIMARY KEY)'))
            connection.execute(text('INSERT INTO "AnalyticsJob" (id) VALUES (\'existing\')'))
            with Operations.context(MigrationContext.configure(connection)):
                migration.upgrade()
                columns = {column["name"]: column for column in inspect(connection).get_columns("AnalyticsJob")}
                assert columns["leaseExpiresAt"]["nullable"]
                assert connection.execute(text('SELECT "leaseExpiresAt" FROM "AnalyticsJob"')).scalar() is None
                migration.downgrade()
            assert [column["name"] for column in inspect(connection).get_columns("AnalyticsJob")] == ["id"]
            assert connection.execute(text('SELECT id FROM "AnalyticsJob"')).scalar() == "existing"
    finally:
        engine.dispose()
