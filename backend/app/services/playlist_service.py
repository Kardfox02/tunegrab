import uuid
from collections.abc import Sequence

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.playlist import Playlist, PlaylistAccess, PlaylistTrack
from app.models.track import Track
from app.models.user import User
from app.services.track_service import TrackNotFoundError


class PlaylistNotFoundError(Exception):
    """Плейлист не существует или недоступен пользователю."""


class PlaylistNotOwnedError(Exception):
    """Действие разрешено только автору плейлиста."""


class TrackAlreadyInPlaylistError(Exception):
    """Трек уже добавлен в плейлист (UNIQUE-констрейнт)."""


class PlaylistOrderMismatchError(Exception):
    """track_ids не совпадают с текущим составом плейлиста."""


class PlaylistService:
    async def list_playlists(
        self,
        session: AsyncSession,
        user: User,
    ) -> list[tuple[Playlist, str, bool]]:
        """Свои и подписные плейлисты.

        Возвращает (плейлист, имя автора, is_owner).
        """

        own = (
            await session.scalars(
                select(Playlist)
                .where(Playlist.user_id == user.id)
                .options(selectinload(Playlist.tracks))
                .order_by(Playlist.created_at, Playlist.id)
            )
        ).all()

        subscribed = (
            await session.execute(
                select(Playlist, User.username)
                .join(PlaylistAccess, PlaylistAccess.playlist_id == Playlist.id)
                .join(User, User.id == Playlist.user_id)
                .where(PlaylistAccess.user_id == user.id)
                .options(selectinload(Playlist.tracks))
                .order_by(Playlist.created_at, Playlist.id)
            )
        ).all()

        rows: list[tuple[Playlist, str, bool]] = [
            (playlist, user.username, True) for playlist in own
        ]
        rows.extend((playlist, username, False) for playlist, username in subscribed)
        return rows

    async def create_playlist(
        self,
        session: AsyncSession,
        user_id: int,
        name: str,
    ) -> Playlist:
        playlist = Playlist(user_id=user_id, name=name)
        session.add(playlist)
        await session.commit()
        await session.refresh(playlist)
        return playlist

    async def get_accessible_playlist(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
    ) -> Playlist:
        """Плейлист доступен, если пользователь автор или подписчик."""

        playlist = await session.get(Playlist, playlist_id)
        if playlist is None:
            raise PlaylistNotFoundError
        if playlist.user_id == user_id:
            return playlist
        access = await session.get(PlaylistAccess, (playlist_id, user_id))
        if access is None:
            raise PlaylistNotFoundError
        return playlist

    async def get_owned_playlist(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
    ) -> Playlist:
        """Только автор: удаление плейлиста и управление share-ссылкой."""

        playlist = await session.get(Playlist, playlist_id)
        if playlist is None or playlist.user_id != user_id:
            raise PlaylistNotOwnedError
        return playlist

    async def get_playlist_detail(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
    ) -> tuple[Playlist, str, bool, Sequence[tuple[Track, int]]]:
        """(плейлист, имя автора, is_owner, треки по позиции)."""

        playlist = await self.get_accessible_playlist(session, user_id, playlist_id)
        owner_username = await self._owner_username(session, playlist)
        rows = (
            await session.execute(
                select(Track, PlaylistTrack.position)
                .join(PlaylistTrack, PlaylistTrack.track_id == Track.id)
                .where(PlaylistTrack.playlist_id == playlist_id)
                .order_by(PlaylistTrack.position)
            )
        ).all()
        return playlist, owner_username, playlist.user_id == user_id, rows

    async def _owner_username(self, session: AsyncSession, playlist: Playlist) -> str:
        return await session.scalar(select(User.username).where(User.id == playlist.user_id)) or ""

    async def update_playlist(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
        name: str,
    ) -> Playlist:
        playlist = await self.get_accessible_playlist(session, user_id, playlist_id)
        playlist.name = name
        await session.commit()
        await session.refresh(playlist)
        return playlist

    async def delete_playlist(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
    ) -> None:
        playlist = await self.get_owned_playlist(session, user_id, playlist_id)
        await session.delete(playlist)
        await session.commit()

    async def add_track(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
        track_id: int,
    ) -> None:
        await self.get_accessible_playlist(session, user_id, playlist_id)

        track = await session.get(Track, track_id)
        if track is None:
            raise TrackNotFoundError

        max_position = await session.scalar(
            select(func.max(PlaylistTrack.position)).where(
                PlaylistTrack.playlist_id == playlist_id
            )
        )
        link = PlaylistTrack(
            playlist_id=playlist_id,
            track_id=track_id,
            position=(max_position or 0) + 1,
        )
        session.add(link)
        try:
            await session.commit()
        except Exception:
            await session.rollback()
            raise TrackAlreadyInPlaylistError

    async def remove_track(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
        track_id: int,
    ) -> None:
        await self.get_accessible_playlist(session, user_id, playlist_id)

        result = await session.execute(
            delete(PlaylistTrack)
            .where(
                PlaylistTrack.playlist_id == playlist_id,
                PlaylistTrack.track_id == track_id,
            )
        )
        if result.rowcount == 0:
            raise TrackNotFoundError

        await self._compact_positions(session, playlist_id)
        await session.commit()

    async def set_order(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
        track_ids: list[int],
    ) -> None:
        await self.get_accessible_playlist(session, user_id, playlist_id)

        rows = (
            await session.scalars(
                select(PlaylistTrack.track_id)
                .where(PlaylistTrack.playlist_id == playlist_id)
            )
        ).all()
        current_ids = set(rows)
        if current_ids != set(track_ids) or len(track_ids) != len(current_ids):
            raise PlaylistOrderMismatchError

        links = (
            await session.scalars(
                select(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist_id)
            )
        ).all()
        position_by_id = {track_id: index + 1 for index, track_id in enumerate(track_ids)}
        for link in links:
            link.position = position_by_id[link.track_id]
        await session.commit()

    async def set_share_token(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
    ) -> str:
        """Создаёт или ротирует share-токен. Возвращает новый токен."""

        playlist = await self.get_owned_playlist(session, user_id, playlist_id)
        playlist.share_token = str(uuid.uuid4())
        await session.commit()
        return playlist.share_token

    async def revoke_share_token(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
    ) -> None:
        playlist = await self.get_owned_playlist(session, user_id, playlist_id)
        playlist.share_token = None
        await session.commit()

    async def subscribe_by_token(
        self,
        session: AsyncSession,
        user: User,
        token: str,
    ) -> Playlist:
        """Автоподписка по share-токену (идемпотентно).

        Автор открывает свою ссылку — без подписки, просто плейлист.
        """

        playlist = (
            await session.scalars(select(Playlist).where(Playlist.share_token == token))
        ).first()
        if playlist is None:
            raise PlaylistNotFoundError

        if playlist.user_id != user.id:
            existing = await session.get(PlaylistAccess, (playlist.id, user.id))
            if existing is None:
                session.add(PlaylistAccess(playlist_id=playlist.id, user_id=user.id))
                await session.commit()
        return playlist

    async def unsubscribe(
        self,
        session: AsyncSession,
        user_id: int,
        playlist_id: int,
    ) -> None:
        """Отписка от плейлиста. Автор не может отписаться от своего."""

        playlist = await session.get(Playlist, playlist_id)
        if playlist is None:
            raise PlaylistNotFoundError
        if playlist.user_id == user_id:
            raise PlaylistNotOwnedError
        result = await session.execute(
            delete(PlaylistAccess).where(
                PlaylistAccess.playlist_id == playlist_id,
                PlaylistAccess.user_id == user_id,
            )
        )
        if result.rowcount == 0:
            raise PlaylistNotFoundError
        await session.commit()

    async def get_shared(
        self,
        session: AsyncSession,
        token: str,
    ) -> tuple[Playlist, str, Sequence[tuple[Track, int]]]:
        """Публичный доступ по токену. Возвращает плейлист, имя владельца и треки."""

        row = (
            await session.execute(
                select(Playlist, User.username)
                .join(User, User.id == Playlist.user_id)
                .where(Playlist.share_token == token)
            )
        ).first()
        if row is None:
            raise PlaylistNotFoundError

        playlist, owner_username = row
        tracks = (
            await session.execute(
                select(Track, PlaylistTrack.position)
                .join(PlaylistTrack, PlaylistTrack.track_id == Track.id)
                .where(PlaylistTrack.playlist_id == playlist.id)
                .order_by(PlaylistTrack.position)
            )
        ).all()
        return playlist, owner_username, tracks

    async def _compact_positions(self, session: AsyncSession, playlist_id: int) -> None:
        rows = (
            await session.scalars(
                select(PlaylistTrack)
                .where(PlaylistTrack.playlist_id == playlist_id)
                .order_by(PlaylistTrack.position)
            )
        ).all()
        for index, link in enumerate(rows, start=1):
            link.position = index


playlist_service = PlaylistService()
