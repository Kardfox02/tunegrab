from collections.abc import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.models.base import Base

engine = create_async_engine(settings.database_url, connect_args={"timeout": 30})
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def configure_sqlite_connection(dbapi_connection, _connection_record=None) -> None:
    def _unicode_casefold(value):
        # SQLite lower()/LIKE сворачивают только ASCII, кириллица требует UDF
        return value.casefold() if isinstance(value, str) else value

    dbapi_connection.create_function("casefold", 1, _unicode_casefold, deterministic=True)
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


@event.listens_for(engine.sync_engine, "connect")
def configure_sqlite(dbapi_connection, _connection_record) -> None:
    configure_sqlite_connection(dbapi_connection, _connection_record)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def dispose_database() -> None:
    await engine.dispose()
