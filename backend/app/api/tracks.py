from fastapi import APIRouter, Depends, Query, Response, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.tracks import TrackListResponse, TrackResponse, TrackSortField, TrackSortOrder
from app.services.track_service import track_service
from app.services.upload_service import upload_track as upload_track_service


router = APIRouter(prefix="/tracks", tags=["tracks"])


@router.get("", response_model=TrackListResponse, summary="List library tracks")
async def list_tracks(
    q: str | None = Query(default=None, max_length=200),
    sort_by: TrackSortField = Query(default=TrackSortField.created_at),
    order: TrackSortOrder = Query(default=TrackSortOrder.desc),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TrackListResponse:
    tracks, total = await track_service.list_tracks(
        session,
        query=q,
        sort_by=sort_by,
        order=order,
        limit=limit,
        offset=offset,
    )
    return TrackListResponse(
        items=[TrackResponse.from_track(track) for track in tracks],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.delete("/{track_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a library track")
async def delete_track(
    track_id: int,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await track_service.delete_track(session, track_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/upload", response_model=TrackResponse, status_code=status.HTTP_201_CREATED, summary="Upload a local mp3 to the library")
async def upload_track(
    file: UploadFile,
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> TrackResponse:
    content = await file.read()
    track = await upload_track_service(session, filename=file.filename or "", content=content)
    return TrackResponse.from_track(track)
