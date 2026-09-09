import asyncio
import shutil
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.track import Track
from app.schemas.admin import AdminHealthResponse, StorageBreakdownResponse
from app.storage import cleanup_orphan_files, verify_storage


def _directory_size(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def _collect_health_sync() -> tuple[StorageBreakdownResponse, bool, int, int]:
    ensure_ok = settings.downloads_dir.is_dir() and settings.covers_dir.is_dir()
    covers = settings.covers_dir
    thumbnails = settings.thumbnails_dir
    covers_bytes = _directory_size(covers) if covers.is_dir() else 0
    thumbnails_bytes = _directory_size(thumbnails) if thumbnails.is_dir() else 0
    audio_bytes = 0
    if settings.downloads_dir.is_dir():
        audio_bytes = max(_directory_size(settings.downloads_dir) - covers_bytes - thumbnails_bytes, 0)
    storage = StorageBreakdownResponse(
        audio_bytes=audio_bytes,
        covers_bytes=covers_bytes,
        thumbnails_bytes=thumbnails_bytes,
        total_bytes=audio_bytes + covers_bytes + thumbnails_bytes,
    )
    # Свободное место — тот же том, где лежит хранилище.
    disk_usage = shutil.disk_usage(settings.downloads_dir)
    return storage, ensure_ok, disk_usage.total, disk_usage.free


class AdminService:
    async def get_health(self, session: AsyncSession, track_count: int) -> AdminHealthResponse:
        storage, storage_ok, disk_total, disk_free = await asyncio.to_thread(_collect_health_sync)
        return AdminHealthResponse(
            status="ok",
            storage_ok=storage_ok,
            ffmpeg_found=shutil.which(settings.ffmpeg_path) is not None,
            track_count=track_count,
            disk_total_bytes=disk_total,
            disk_free_bytes=disk_free,
            storage=storage,
        )

    async def count_tracks(self, session: AsyncSession) -> int:
        return (await session.scalar(select(func.count(Track.id)))) or 0

    async def clear_thumbnails(self) -> tuple[int, int]:
        thumbnails_dir = settings.thumbnails_dir
        if not thumbnails_dir.is_dir():
            return 0, 0
        deleted_files = 0
        freed_bytes = 0

        def _clear() -> tuple[int, int]:
            nonlocal deleted_files, freed_bytes
            for item in thumbnails_dir.iterdir():
                if item.is_file():
                    freed_bytes += item.stat().st_size
                    item.unlink()
                    deleted_files += 1
            return deleted_files, freed_bytes

        return await asyncio.to_thread(_clear)

    async def run_verify_storage(self, session: AsyncSession) -> list[str]:
        errors = await verify_storage(session)
        if shutil.which(settings.ffmpeg_path) is None:
            errors.append(f"ffmpeg not found: {settings.ffmpeg_path}")
        return errors

    async def run_cleanup_orphans(self, session: AsyncSession, dry_run: bool = False) -> list[Path]:
        return await cleanup_orphan_files(session, dry_run=dry_run)


admin_service = AdminService()
