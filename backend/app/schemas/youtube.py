from pydantic import BaseModel, ConfigDict, Field

from app.schemas.tracks import TrackResponse


class YouTubeSearchResult(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    youtube_id: str
    title: str
    author: str
    duration: float | None = None
    thumbnail_url: str | None = None
    webpage_url: str


class YouTubeSearchResponse(BaseModel):
    items: list[YouTubeSearchResult]


class YouTubeDownloadRequest(BaseModel):
    youtube_id: str = Field(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9_-]+$")
    title: str = Field(min_length=1, max_length=1000)
    author: str = Field(min_length=1, max_length=1000)
    duration: float | None = Field(default=None, ge=0)
    webpage_url: str | None = None
    thumbnail_url: str | None = None


class YouTubeDownloadResponse(BaseModel):
    track: TrackResponse
    queued: bool


class ActiveDownloadsResponse(BaseModel):
    items: list[TrackResponse]
