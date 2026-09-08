from datetime import datetime

from pydantic import BaseModel

from app.schemas.tracks import TrackResponse


class LikeResponse(BaseModel):
    track: TrackResponse
    created_at: datetime


class LikeListResponse(BaseModel):
    items: list[LikeResponse]
    total: int
    limit: int
    offset: int


class LikedTrackIdsResponse(BaseModel):
    track_ids: list[int]
