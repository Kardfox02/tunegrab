import importlib.util
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text


def _run_migration(connection, migration, operation: str) -> None:
    context = MigrationContext.configure(connection)
    with Operations.context(context):
        getattr(migration, operation)()


def _load_migration(name: str):
    path = Path(__file__).parents[1] / "alembic" / "versions" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_active_downloads_index_upgrade_and_downgrade_preserve_data(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    initial = _load_migration("0001_initial_schema")
    migration = _load_migration("0002_active_downloads_index")

    with engine.begin() as connection:
        _run_migration(connection, initial, "upgrade")
        connection.execute(
            text(
                "INSERT INTO tracks (youtube_id, title, author, status, progress) "
                "VALUES ('existing', 'Existing', 'Artist', 'done', 100)"
            )
        )
        _run_migration(connection, migration, "upgrade")

        indexes = {index["name"] for index in inspect(connection).get_indexes("tracks")}
        assert "ix_tracks_status_created_at" in indexes

        _run_migration(connection, migration, "downgrade")

        indexes = {index["name"] for index in inspect(connection).get_indexes("tracks")}
        assert "ix_tracks_status_created_at" not in indexes
        row = connection.execute(
            text("SELECT youtube_id, title FROM tracks WHERE youtube_id = 'existing'")
        ).one()
        assert tuple(row) == ("existing", "Existing")

    engine.dispose()
