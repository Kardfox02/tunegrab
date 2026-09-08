from collections.abc import Sequence

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import Like
from app.models.track import Track
from app.services.track_service import TrackNotFoundError


class LikeService:
    async def list_likes(
        self,
        session: AsyncSession,
        user_id: int,
        *,
        limit: int,
        offset: int,
    ) -> tuple[Sequence[tuple[Like, Track]], int]:
        base_filter = Like.user_id == user_id

        total = int(
            await session.scalar(
                select(func.count()).select_from(Like).where(base_filter)
            ) or 0
        )

        rows = (
            await session.execute(
                select(Like, Track)
                .join(Track, Track.id == Like.track_id)
                .where(base_filter)
                .order_by(desc(Like.created_at), desc(Like.track_id))
                .limit(limit)
                .offset(offset)
            )
        ).all()
        return rows, total

    async def get_liked_track_ids(
        self,
        session: AsyncSession,
        user_id: int,
    ) -> set[int]:
        rows = (
            await session.scalars(select(Like.track_id).where(Like.user_id == user_id))
        ).all()
        return set(rows)

    async def add_like(self, session: AsyncSession, user_id: int, track_id: int) -> Like | None:
        """Идемпотентно ставит лайк. None — лайк уже существовал."""

        track = await session.get(Track, track_id)
        if track is None:
            raise TrackNotFoundError

        existing = await session.get(Like, (user_id, track_id))
        if existing is not None:
            return None

        like = Like(user_id=user_id, track_id=track_id)
        session.add(like)
        await session.commit()
        await session.refresh(like)
        return like

    async def remove_like(self, session: AsyncSession, user_id: int, track_id: int) -> bool:
        """Идемпотентно снимает лайк. True — лайк был снят этим вызовом."""

        like = await session.get(Like, (user_id, track_id))
        if like is None:
            return False

        await session.delete(like)
        await session.commit()
        return True


like_service = LikeService()
