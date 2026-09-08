from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.track import Track
from app.models.user import User
from app.schemas.likes import LikeListResponse, LikeResponse, LikedTrackIdsResponse
from app.schemas.tracks import TrackResponse
from app.services.like_service import like_service
from app.services.track_service import TrackNotFoundError


router = APIRouter(prefix="/likes", tags=["likes"])


@router.get("", response_model=LikeListResponse, summary="List liked tracks of the current user")
async def list_likes(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LikeListResponse:
    rows, total = await like_service.list_likes(session, user.id, limit=limit, offset=offset)
    return LikeListResponse(
        items=[
            {"track": TrackResponse.from_track(track), "created_at": like.created_at}
            for like, track in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/ids",
    response_model=LikedTrackIdsResponse,
    summary="All liked track ids of the current user (for heart states)",
)
async def list_liked_track_ids(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LikedTrackIdsResponse:
    track_ids = await like_service.get_liked_track_ids(session, user.id)
    return LikedTrackIdsResponse(track_ids=sorted(track_ids))


@router.put(
    "/{track_id}",
    response_model=LikeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Like a track (idempotent)",
)
async def add_like(
    track_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    try:
        like = await like_service.add_like(session, user.id, track_id)
    except TrackNotFoundError:
        raise
    if like is None:
        # Лайк уже существовал (идемпотентный повтор) — 200 без тела.
        return Response(status_code=status.HTTP_200_OK)
    track = await session.get(Track, track_id)
    return LikeResponse(track=TrackResponse.from_track(track), created_at=like.created_at)


@router.delete(
    "/{track_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a like (idempotent)",
)
async def remove_like(
    track_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await like_service.remove_like(session, user.id, track_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
