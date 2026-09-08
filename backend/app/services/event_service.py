from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import ListenEvent
from app.models.track import Track
from app.schemas.events import ListenEventCreate
from app.schemas.tracks import TrackResponse
from app.services.track_service import TrackNotFoundError


class EventService:
    async def record_event(
        self,
        session: AsyncSession,
        user_id: int,
        payload: ListenEventCreate,
    ) -> ListenEvent:
        track = await session.get(Track, payload.track_id)
        if track is None:
            raise TrackNotFoundError

        event = ListenEvent(
            user_id=user_id,
            track_id=payload.track_id,
            event_type=payload.event_type,
            fraction_played=payload.fraction_played,
        )
        session.add(event)
        await session.commit()
        await session.refresh(event)
        return event

    async def get_stats(
        self,
        session: AsyncSession,
        user_id: int,
        *,
        days: int = 7,
        top_limit: int = 3,
    ) -> dict:
        # SQLite хранит CURRENT_TIMESTAMP в UTC.
        since = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=days)

        counts = dict(
            (await session.execute(
                select(ListenEvent.event_type, func.count())
                .where(ListenEvent.user_id == user_id, ListenEvent.created_at >= since)
                .group_by(ListenEvent.event_type)
            )).all()
        )

        # Суммарное время: fraction_played × длительность трека (часы прослушивания
        # считать по завершённым долям корректнее, чем по числу событий).
        listened_seconds = float(
            await session.scalar(
                select(
                    func.coalesce(
                        func.sum(ListenEvent.fraction_played * Track.duration),
                        0.0,
                    )
                )
                .select_from(ListenEvent)
                .join(Track, Track.id == ListenEvent.track_id)
                .where(
                    ListenEvent.user_id == user_id,
                    ListenEvent.created_at >= since,
                    Track.duration.is_not(None),
                )
            ) or 0.0
        )

        # Топ: ранжируем по «затухающему» счёту запусков (экспоненциальное
        # затухание с полураспадом 2 дня) — недавние прослушивания весят больше,
        # и то, что слушают сейчас, быстрее поднимается в топе. Время считаем по
        # всем событиям трека (play+skip+complete — фактическое прослушанное время).
        play_weight = case((ListenEvent.event_type == "play", 1), else_=0)
        # created_at хранится в UTC; julianday('now') тоже UTC.
        freshness = func.power(
            2.0,
            -(func.julianday("now") - func.julianday(ListenEvent.created_at)) / 2.0,
        )
        listened = func.coalesce(
            func.sum(ListenEvent.fraction_played * Track.duration), 0.0
        )
        top_rows = (
            await session.execute(
                select(
                    Track,
                    func.sum(play_weight).label("play_count"),
                    listened.label("listened_seconds"),
                    func.sum(
                        case((ListenEvent.event_type == "play", freshness), else_=0.0)
                    ).label("decay_score"),
                )
                .select_from(ListenEvent)
                .join(Track, Track.id == ListenEvent.track_id)
                .where(
                    ListenEvent.user_id == user_id,
                    ListenEvent.created_at >= since,
                )
                .group_by(Track.id)
                .having(func.sum(play_weight) > 0)
                .order_by(desc("decay_score"), Track.id.asc())
                .limit(top_limit)
            )
        ).all()

        return {
            "period_days": days,
            "play_count": int(counts.get("play", 0)),
            "skip_count": int(counts.get("skip", 0)),
            "complete_count": int(counts.get("complete", 0)),
            "listened_seconds": listened_seconds,
            "top_tracks": [
                {
                    "track": TrackResponse.from_track(track),
                    "play_count": int(play_count),
                    "listened_seconds": float(row_listened),
                }
                for track, play_count, row_listened, _decay_score in top_rows
            ],
        }

    async def get_history(
        self,
        session: AsyncSession,
        user_id: int,
        *,
        limit: int,
        offset: int,
    ) -> tuple[Sequence[tuple[ListenEvent, Track]], int]:
        base_filter = ListenEvent.user_id == user_id

        total = int(
            await session.scalar(
                select(func.count()).select_from(ListenEvent).where(base_filter)
            ) or 0
        )

        rows = (
            await session.execute(
                select(ListenEvent, Track)
                .join(Track, Track.id == ListenEvent.track_id)
                .where(base_filter)
                .order_by(desc(ListenEvent.created_at), desc(ListenEvent.id))
                .limit(limit)
                .offset(offset)
            )
        ).all()
        return rows, total


event_service = EventService()
