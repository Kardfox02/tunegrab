from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.tracks import TrackResponse


class PlaylistCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class PlaylistUpdateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class PlaylistResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    track_count: int
    created_at: datetime
    owner_username: str
    is_owner: bool
    share_url: str | None = None


class PlaylistDetailResponse(BaseModel):
    id: int
    name: str
    created_at: datetime
    owner_username: str
    is_owner: bool
    share_url: str | None = None
    items: list[TrackResponse] = []


class PlaylistListResponse(BaseModel):
    items: list[PlaylistResponse]
    total: int


class PlaylistAddTrackRequest(BaseModel):
    track_id: int = Field(ge=1)


class PlaylistOrderRequest(BaseModel):
    track_ids: list[int]


class SubscribeResponse(BaseModel):
    playlist_id: int


class SharedPlaylistResponse(BaseModel):
    name: str
    owner_username: str
    tracks: list[TrackResponse]
