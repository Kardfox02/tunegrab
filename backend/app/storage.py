import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.track import Track

logger = logging.getLogger(__name__)


def ensure_directories() -> None:
    settings.downloads_dir.mkdir(parents=True, exist_ok=True)
    settings.covers_dir.mkdir(parents=True, exist_ok=True)
    settings.thumbnails_dir.mkdir(parents=True, exist_ok=True)
    settings.logs_dir.mkdir(parents=True, exist_ok=True)


def resolve_download_path(relative_path: str) -> Path:
    root = settings.downloads_dir.resolve()
    resolved = (root / relative_path).resolve()
    if resolved != root and root not in resolved.parents:
        raise ValueError("path is outside downloads directory")
    return resolved


async def referenced_files(session: AsyncSession) -> set[Path]:
    tracks = (await session.execute(select(Track.file_path, Track.cover_path))).all()
    result: set[Path] = set()
    for file_path, cover_path in tracks:
        for value in (file_path, cover_path):
            if value:
                try:
                    result.add(resolve_download_path(value))
                except ValueError:
                    logger.error("Invalid path stored in database: %s", value)
    return result


async def scan_orphan_files(session: AsyncSession) -> list[Path]:
    referenced = await referenced_files(session)
    files = [path for path in settings.downloads_dir.rglob("*") if path.is_file() and path not in referenced]
    return sorted(files)


async def cleanup_orphan_files(session: AsyncSession, dry_run: bool = False) -> list[Path]:
    orphans = await scan_orphan_files(session)
    if not dry_run:
        for path in orphans:
            path.unlink()
    return orphans


async def verify_storage(session: AsyncSession) -> list[str]:
    errors: list[str] = []
    for directory in (settings.downloads_dir, settings.covers_dir):
        if not directory.is_dir():
            errors.append(f"missing directory: {directory}")
    for track in (await session.execute(select(Track))).scalars():
        if track.file_path:
            try:
                if not resolve_download_path(track.file_path).is_file():
                    errors.append(f"missing track file: {track.file_path}")
            except ValueError:
                errors.append(f"unsafe track path: {track.file_path}")
    return errors
