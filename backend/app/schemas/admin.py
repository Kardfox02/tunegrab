from pydantic import BaseModel


class StorageBreakdownResponse(BaseModel):
    audio_bytes: int
    covers_bytes: int
    thumbnails_bytes: int
    total_bytes: int


class AdminHealthResponse(BaseModel):
    status: str
    storage_ok: bool
    ffmpeg_found: bool
    track_count: int
    disk_total_bytes: int
    disk_free_bytes: int
    storage: StorageBreakdownResponse


class ThumbnailsClearResponse(BaseModel):
    deleted_files: int
    freed_bytes: int


class VerifyStorageResponse(BaseModel):
    ok: bool
    errors: list[str]


class CleanupOrphansResponse(BaseModel):
    deleted_count: int
    files: list[str]
