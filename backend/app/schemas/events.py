from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.tracks import TrackResponse


ListenEventType = Literal["play", "skip", "complete"]

COMPLETE_MIN_FRACTION = 0.9


class ListenEventCreate(BaseModel):
    track_id: int = Field(ge=1)
    event_type: ListenEventType
    fraction_played: float = Field(ge=0.0, le=1.0)

    @model_validator(mode="after")
    def validate_complete_fraction(self) -> "ListenEventCreate":
        if self.event_type == "complete" and self.fraction_played < COMPLETE_MIN_FRACTION:
            raise ValueError(
                f"complete events require fraction_played >= {COMPLETE_MIN_FRACTION}"
            )
        return self


class ListenEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    track_id: int
    event_type: ListenEventType
    fraction_played: float
    created_at: datetime


class TopTrackEntry(BaseModel):
    track: TrackResponse
    play_count: int
    listened_seconds: float


class ListeningStatsResponse(BaseModel):
    period_days: int
    play_count: int
    skip_count: int
    complete_count: int
    listened_seconds: float
    top_tracks: list[TopTrackEntry]


class ListeningHistoryItem(BaseModel):
    event: ListenEventResponse
    track: TrackResponse


class ListeningHistoryResponse(BaseModel):
    items: list[ListeningHistoryItem]
    total: int
    limit: int
    offset: int
