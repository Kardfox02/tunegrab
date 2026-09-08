from datetime import datetime
from enum import Enum
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from app.config import settings
from app.models.track import Track
from app.storage import resolve_download_path


class TrackSortField(str, Enum):
    created_at = "created_at"
    title = "title"
    author = "author"
    duration = "duration"
    file_size = "file_size"
    progress = "progress"
    status = "status"


class TrackSortOrder(str, Enum):
    asc = "asc"
    desc = "desc"


class TrackResponse(BaseModel):
    id: int
    youtube_id: str
    title: str
    author: str
    duration: float | None
    status: str
    progress: float
    file_size: int | None
    created_at: datetime
    audio_url: str | None
    cover_url: str | None

    @classmethod
    def from_track(cls, track: Track) -> "TrackResponse":
        return cls(
            id=track.id,
            youtube_id=track.youtube_id,
            title=track.title,
            author=track.author,
            duration=track.duration,
            status=track.status,
            progress=track.progress,
            file_size=track.file_size,
            created_at=track.created_at,
            audio_url=_audio_url(track),
            cover_url=_cover_url(track),
        )


def _audio_url(track: Track) -> str | None:
    if not track.file_path:
        return None
    try:
        if resolve_download_path(track.file_path).is_file():
            return f"/stream/{track.id}"
    except ValueError:
        pass
    return None


def _cover_url(track: Track) -> str | None:
    if not track.cover_path:
        return None
    try:
        if Path(track.cover_path).is_absolute():
            return None
        cover_root = settings.covers_dir.resolve()
        cover_file = resolve_download_path(track.cover_path)
        if cover_file != cover_root and cover_root not in cover_file.parents:
            return None
        return "/covers/" + cover_file.relative_to(cover_root).as_posix()
    except (ValueError, OSError):
        return None


class TrackListResponse(BaseModel):
    items: list[TrackResponse]
    total: int
    limit: int = Field(ge=1, le=100)
    offset: int = Field(ge=0)
