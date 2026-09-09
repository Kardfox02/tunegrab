from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.admin import (
    AdminHealthResponse,
    CleanupOrphansResponse,
    ThumbnailsClearResponse,
    VerifyStorageResponse,
)
from app.services.admin_service import admin_service


router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/health", response_model=AdminHealthResponse, summary="Detailed service health for the admin panel")
async def health(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AdminHealthResponse:
    track_count = await admin_service.count_tracks(session)
    return await admin_service.get_health(session, track_count)


@router.post(
    "/thumbnails/clear",
    response_model=ThumbnailsClearResponse,
    summary="Delete all cached YouTube thumbnails",
)
async def clear_thumbnails(
    _user: User = Depends(get_current_user),
) -> ThumbnailsClearResponse:
    deleted_files, freed_bytes = await admin_service.clear_thumbnails()
    return ThumbnailsClearResponse(deleted_files=deleted_files, freed_bytes=freed_bytes)


@router.post(
    "/commands/verify-storage",
    response_model=VerifyStorageResponse,
    summary="Run storage verification (CLI verify-storage)",
)
async def verify_storage(
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> VerifyStorageResponse:
    errors = await admin_service.run_verify_storage(session)
    return VerifyStorageResponse(ok=not errors, errors=errors)


@router.post(
    "/commands/cleanup-orphans",
    response_model=CleanupOrphansResponse,
    summary="Delete orphan files (CLI cleanup-orphans)",
)
async def cleanup_orphans(
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CleanupOrphansResponse:
    orphans: list[Path] = await admin_service.run_cleanup_orphans(session, dry_run=False)
    return CleanupOrphansResponse(
        deleted_count=len(orphans),
        files=[str(path.relative_to(settings.downloads_dir)) for path in orphans],
    )
