from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.events import (
    ListenEventCreate,
    ListenEventResponse,
    ListeningHistoryResponse,
    ListeningStatsResponse,
)
from app.schemas.tracks import TrackResponse
from app.services.event_service import event_service
from app.services.track_service import TrackNotFoundError


router = APIRouter(prefix="/events", tags=["events"])


@router.post(
    "",
    response_model=ListenEventResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a listening event",
)
async def record_event(
    payload: ListenEventCreate,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ListenEventResponse:
    try:
        event = await event_service.record_event(session, user.id, payload)
    except TrackNotFoundError:
        raise
    return ListenEventResponse.model_validate(event)


@router.get(
    "/me/stats",
    response_model=ListeningStatsResponse,
    summary="Listening statistics for the current user",
)
async def get_stats(
    period_days: int = Query(default=7, ge=1, le=30),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ListeningStatsResponse:
    stats = await event_service.get_stats(session, user.id, days=period_days)
    return ListeningStatsResponse(
        period_days=stats["period_days"],
        play_count=stats["play_count"],
        skip_count=stats["skip_count"],
        complete_count=stats["complete_count"],
        listened_seconds=stats["listened_seconds"],
        top_tracks=stats["top_tracks"],
    )


@router.get(
    "/me/history",
    response_model=ListeningHistoryResponse,
    summary="Listening history for the current user",
)
async def get_history(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ListeningHistoryResponse:
    rows, total = await event_service.get_history(session, user.id, limit=limit, offset=offset)
    return ListeningHistoryResponse(
        items=[
            {"event": ListenEventResponse.model_validate(event), "track": TrackResponse.from_track(track)}
            for event, track in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
