import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies.auth import get_current_user
from app.download.manager import DownloadManager, download_manager
from app.models.track import Track
from app.models.user import User
from app.rate_limit import InMemoryRateLimiter
from app.schemas.tracks import TrackResponse
from app.schemas.youtube import (
    ActiveDownloadsResponse,
    YouTubeDownloadRequest,
    YouTubeDownloadResponse,
    YouTubeSearchResponse,
    YouTubeSearchResult,
)
from app.services import thumbnail_service
from app.services import youtube_service
from app.services.track_service import track_service
from app.config import settings

router = APIRouter(prefix="/youtube", tags=["youtube"])
search_limiter = InMemoryRateLimiter(
    settings.youtube_search_rate_limit,
    settings.youtube_search_rate_window_seconds,
)


@router.get("/search", response_model=YouTubeSearchResponse, summary="Search YouTube")
async def search_youtube(
    request: Request,
    q: str = Query(min_length=1, max_length=200),
    limit: int = Query(default=10, ge=1, le=20),
    _user: User = Depends(get_current_user),
) -> YouTubeSearchResponse:
    key = request.client.host if request.client else "unknown"
    if not search_limiter.allow(key):
        raise HTTPException(status_code=429, detail="Too many search requests")
    results = await youtube_service.search(q.strip(), min(limit, settings.youtube_search_max_results))
    return YouTubeSearchResponse(
        items=[
            YouTubeSearchResult.model_validate(result).model_copy(
                update={"thumbnail_url": f"/youtube/thumbnail/{result.youtube_id}"},
            )
            for result in results
        ],
    )


_THUMBNAIL_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


@router.get("/thumbnail/{youtube_id}", summary="Proxied YouTube thumbnail", response_class=FileResponse)
async def get_thumbnail(
    youtube_id: str,
    _user: User = Depends(get_current_user),
) -> FileResponse:
    if _THUMBNAIL_ID_PATTERN.fullmatch(youtube_id) is None:
        raise HTTPException(status_code=404, detail="Thumbnail not found")

    try:
        path = await thumbnail_service.get_thumbnail_path(youtube_id)
    except thumbnail_service.ThumbnailFetchError:
        raise HTTPException(status_code=404, detail="Thumbnail not found") from None

    return FileResponse(
        path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=604800"},
    )


@router.post("/download", response_model=YouTubeDownloadResponse, status_code=status.HTTP_202_ACCEPTED, summary="Queue YouTube download")
async def queue_download(
    payload: YouTubeDownloadRequest,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> YouTubeDownloadResponse:
    existing = await session.scalar(select(Track).where(Track.youtube_id == payload.youtube_id))
    if existing is not None:
        return YouTubeDownloadResponse(track=TrackResponse.from_track(existing), queued=False)

    track = Track(
        youtube_id=payload.youtube_id,
        title=payload.title,
        author=payload.author,
        duration=payload.duration,
        status="pending",
        progress=0,
    )
    session.add(track)
    try:
        await session.commit()
    except IntegrityError:
        await session.rollback()
        existing = await session.scalar(select(Track).where(Track.youtube_id == payload.youtube_id))
        if existing is None:
            raise
        return YouTubeDownloadResponse(track=TrackResponse.from_track(existing), queued=False)
    await download_manager.enqueue(track.id)
    return YouTubeDownloadResponse(track=TrackResponse.from_track(track), queued=True)


@router.get(
    "/downloads/active",
    response_model=ActiveDownloadsResponse,
    summary="List active downloads",
)
async def list_active_downloads(
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ActiveDownloadsResponse:
    tracks = await track_service.list_active_downloads(session)
    return ActiveDownloadsResponse(items=[TrackResponse.from_track(track) for track in tracks])


@router.get("/{track_id}", response_model=TrackResponse, summary="Get YouTube download status")
async def download_status(
    track_id: int,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TrackResponse:
    track = await session.get(Track, track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    return TrackResponse.from_track(track)


@router.post("/cancel/{track_id}", response_model=TrackResponse, summary="Cancel YouTube download")
async def cancel_download(
    track_id: int,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: DownloadManager = Depends(lambda: download_manager),
) -> TrackResponse:
    track = await session.get(Track, track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    await manager.cancel(track_id)
    await session.refresh(track)
    return TrackResponse.from_track(track)


@router.post("/retry/{track_id}", response_model=TrackResponse, summary="Retry YouTube download")
async def retry_download(
    track_id: int,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    manager: DownloadManager = Depends(lambda: download_manager),
) -> TrackResponse:
    track = await session.get(Track, track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")
    if track.status not in {"error", "cancelled"}:
        raise HTTPException(status_code=409, detail="Only failed or cancelled downloads can be retried")
    await manager.retry(track_id)
    await session.refresh(track)
    return TrackResponse.from_track(track)
