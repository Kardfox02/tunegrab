from collections.abc import Sequence

from sqlalchemy import asc, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.track import Track
from app.download.states import TrackStatus
from app.schemas.tracks import TrackSortField, TrackSortOrder
from app.storage import resolve_download_path


class TrackNotFoundError(Exception):
    """The requested track does not exist."""


class TrackFileBusyError(Exception):
    """A track file could not be removed."""


class TrackService:
    _sort_columns = {
        TrackSortField.created_at: Track.created_at,
        TrackSortField.title: Track.title,
        TrackSortField.author: Track.author,
        TrackSortField.duration: Track.duration,
        TrackSortField.file_size: Track.file_size,
        TrackSortField.progress: Track.progress,
        TrackSortField.status: Track.status,
    }

    async def list_tracks(
        self,
        session: AsyncSession,
        *,
        query: str | None,
        sort_by: TrackSortField,
        order: TrackSortOrder,
        limit: int,
        offset: int,
    ) -> tuple[Sequence[Track], int]:
        filters = []
        if query and query.strip():
            pattern = f"%{query.strip().casefold()}%"
            filters.append(
                or_(
                    func.casefold(Track.title).like(pattern),
                    func.casefold(Track.author).like(pattern),
                )
            )

        count_query = select(func.count()).select_from(Track).where(*filters)
        total = int(await session.scalar(count_query) or 0)

        sort_column = self._sort_columns[sort_by]
        sort_expression = asc(sort_column) if order == TrackSortOrder.asc else desc(sort_column)
        tracks = (
            await session.scalars(
                select(Track)
                .where(*filters)
                .order_by(sort_expression, Track.id.asc())
                .limit(limit)
                .offset(offset)
            )
        ).all()
        return tracks, total

    async def list_active_downloads(self, session: AsyncSession) -> list[Track]:
        active_statuses = (
            TrackStatus.PENDING,
            TrackStatus.DOWNLOADING,
            TrackStatus.CONVERTING,
            TrackStatus.FINALIZING,
        )
        return (
            await session.scalars(
                select(Track)
                .where(Track.status.in_(active_statuses))
                .order_by(Track.created_at.asc(), Track.id.asc())
            )
        ).all()

    async def delete_track(self, session: AsyncSession, track_id: int) -> None:
        track = await session.get(Track, track_id)
        if track is None:
            raise TrackNotFoundError

        paths = []
        for relative_path in (track.file_path, track.cover_path):
            if relative_path:
                try:
                    paths.append(resolve_download_path(relative_path))
                except ValueError as error:
                    raise TrackFileBusyError("Track contains an unsafe file path") from error

        try:
            for path in paths:
                try:
                    path.unlink()
                except FileNotFoundError:
                    continue
        except OSError as error:
            raise TrackFileBusyError("Track files could not be removed") from error

        await session.delete(track)
        await session.commit()


track_service = TrackService()
