from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.schemas.playlists import (
    PlaylistAddTrackRequest,
    PlaylistCreateRequest,
    PlaylistDetailResponse,
    PlaylistListResponse,
    PlaylistOrderRequest,
    PlaylistResponse,
    PlaylistUpdateRequest,
    SharedPlaylistResponse,
    SubscribeResponse,
)
from app.schemas.tracks import TrackResponse
from app.services.playlist_service import (
    PlaylistNotFoundError,
    PlaylistNotOwnedError,
    PlaylistOrderMismatchError,
    PlaylistService,
    TrackAlreadyInPlaylistError,
)
from app.services.track_service import TrackNotFoundError

router = APIRouter(prefix="/playlists", tags=["playlists"])

playlist_service = PlaylistService()


def _share_url(share_token: str | None) -> str | None:
    if share_token is None:
        return None
    return f"/shared/{share_token}"


async def _detail_response(
    session: AsyncSession,
    user: User,
    playlist_id: int,
) -> PlaylistDetailResponse:
    playlist, owner_username, is_owner, tracks = await playlist_service.get_playlist_detail(
        session, user.id, playlist_id
    )
    return PlaylistDetailResponse(
        id=playlist.id,
        name=playlist.name,
        created_at=playlist.created_at,
        owner_username=owner_username,
        is_owner=is_owner,
        share_url=_share_url(playlist.share_token),
        items=[TrackResponse.from_track(track) for track, _position in tracks],
    )


@router.get("", response_model=PlaylistListResponse, summary="Own and subscribed playlists of the current user")
async def list_playlists(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlaylistListResponse:
    rows = await playlist_service.list_playlists(session, user)
    items = [
        PlaylistResponse(
            id=playlist.id,
            name=playlist.name,
            track_count=len(playlist.tracks),
            created_at=playlist.created_at,
            owner_username=owner_username,
            is_owner=is_owner,
            share_url=_share_url(playlist.share_token),
        )
        for playlist, owner_username, is_owner in rows
    ]
    return PlaylistListResponse(items=items, total=len(items))


@router.post("", response_model=PlaylistResponse, status_code=status.HTTP_201_CREATED, summary="Create a playlist")
async def create_playlist(
    payload: PlaylistCreateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlaylistResponse:
    playlist = await playlist_service.create_playlist(session, user.id, payload.name)
    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        track_count=0,
        created_at=playlist.created_at,
        owner_username=user.username,
        is_owner=True,
        share_url=None,
    )


@router.get("/shared/{token}", response_model=SharedPlaylistResponse, summary="Public playlist by share token")
async def get_shared_playlist(
    token: str,
    session: AsyncSession = Depends(get_session),
) -> SharedPlaylistResponse:
    playlist, owner_username, tracks = await playlist_service.get_shared(session, token)
    return SharedPlaylistResponse(
        name=playlist.name,
        owner_username=owner_username,
        tracks=[TrackResponse.from_track(track) for track, _position in tracks],
    )


@router.post(
    "/shared/{share_token}/subscribe",
    response_model=SubscribeResponse,
    summary="Subscribe the current user to a shared playlist (idempotent)",
)
async def subscribe_to_shared(
    share_token: str,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> SubscribeResponse:
    playlist = await playlist_service.subscribe_by_token(session, user, share_token)
    return SubscribeResponse(playlist_id=playlist.id)


@router.get("/{playlist_id}", response_model=PlaylistDetailResponse, summary="Playlist details with tracks")
async def get_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlaylistDetailResponse:
    return await _detail_response(session, user, playlist_id)


@router.patch("/{playlist_id}", response_model=PlaylistDetailResponse, summary="Rename a playlist")
async def update_playlist(
    playlist_id: int,
    payload: PlaylistUpdateRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlaylistDetailResponse:
    await playlist_service.update_playlist(session, user.id, playlist_id, payload.name)
    return await _detail_response(session, user, playlist_id)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete a playlist (owner only)")
async def delete_playlist(
    playlist_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await playlist_service.delete_playlist(session, user.id, playlist_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{playlist_id}/tracks",
    response_model=PlaylistDetailResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a track to a playlist",
)
async def add_track(
    playlist_id: int,
    payload: PlaylistAddTrackRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlaylistDetailResponse:
    await playlist_service.add_track(session, user.id, playlist_id, payload.track_id)
    return await _detail_response(session, user, playlist_id)


@router.delete(
    "/{playlist_id}/tracks/{track_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a track from a playlist",
)
async def remove_track(
    playlist_id: int,
    track_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await playlist_service.remove_track(session, user.id, playlist_id, track_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put(
    "/{playlist_id}/tracks/order",
    response_model=PlaylistDetailResponse,
    summary="Reorder playlist tracks",
)
async def set_order(
    playlist_id: int,
    payload: PlaylistOrderRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlaylistDetailResponse:
    await playlist_service.set_order(session, user.id, playlist_id, payload.track_ids)
    return await _detail_response(session, user, playlist_id)


@router.delete(
    "/{playlist_id}/access",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unsubscribe the current user from a playlist",
)
async def unsubscribe(
    playlist_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await playlist_service.unsubscribe(session, user.id, playlist_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{playlist_id}/share", response_model=PlaylistResponse, summary="Create or rotate the share link (owner only)")
async def create_share(
    playlist_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PlaylistResponse:
    token = await playlist_service.set_share_token(session, user.id, playlist_id)
    playlist, _owner, _is_owner, tracks = await playlist_service.get_playlist_detail(
        session, user.id, playlist_id
    )
    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        track_count=len(tracks),
        created_at=playlist.created_at,
        owner_username=user.username,
        is_owner=True,
        share_url=_share_url(token),
    )


@router.delete("/{playlist_id}/share", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke the share link (owner only)")
async def revoke_share(
    playlist_id: int,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    await playlist_service.revoke_share_token(session, user.id, playlist_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
