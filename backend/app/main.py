import logging
import shutil
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.tracks import router as tracks_router
from app.api.stream import router as stream_router
from app.api.youtube import router as youtube_router
from app.api.events import router as events_router
from app.api.likes import router as likes_router
from app.api.admin import router as admin_router
from app.config import settings
from app.database import dispose_database
from app.logging_setup import configure_logging
from app.middleware.origin import OriginMiddleware
from app.storage import ensure_directories
from app.download.manager import download_manager
from app.services.stream_service import (
    StreamRangeNotSatisfiableError,
    StreamTrackNotFoundError,
)
from app.services.track_service import TrackFileBusyError, TrackNotFoundError
from app.services.upload_service import (
    DuplicateTrackError,
    UploadTooLargeError,
    UploadValidationError,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging(settings.logs_dir)
    ensure_directories()
    if shutil.which(settings.ffmpeg_path) is None:
        logger.warning("ffmpeg was not found: %s", settings.ffmpeg_path)
    await download_manager.start()
    yield
    await download_manager.stop()
    await dispose_database()


app = FastAPI(title="Tunegrab API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    OriginMiddleware,
    allowed_origins=settings.allowed_origins,
    allow_private_network=not settings.production,
)
app.mount("/covers", StaticFiles(directory=settings.covers_dir, check_dir=False), name="covers")
app.include_router(auth_router)
app.include_router(tracks_router)
app.include_router(stream_router)
app.include_router(youtube_router)
app.include_router(events_router)
app.include_router(likes_router)
app.include_router(admin_router)


@app.exception_handler(TrackNotFoundError)
async def track_not_found_handler(_request: Request, _error: TrackNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Track not found"})


@app.exception_handler(TrackFileBusyError)
async def track_file_busy_handler(_request: Request, _error: TrackFileBusyError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": "Track files could not be removed"})


@app.exception_handler(StreamTrackNotFoundError)
async def stream_track_not_found_handler(_request: Request, _error: StreamTrackNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Track not found"})


@app.exception_handler(StreamRangeNotSatisfiableError)
async def stream_range_not_satisfiable_handler(
    _request: Request,
    error: StreamRangeNotSatisfiableError,
) -> JSONResponse:
    return JSONResponse(
        status_code=416,
        content={"detail": "Range not satisfiable"},
        headers={"Content-Range": f"bytes */{error.file_size}"},
    )


@app.exception_handler(UploadValidationError)
async def upload_validation_handler(_request: Request, _error: UploadValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": "Only non-empty mp3 files are supported"})


@app.exception_handler(UploadTooLargeError)
async def upload_too_large_handler(_request: Request, _error: UploadTooLargeError) -> JSONResponse:
    return JSONResponse(status_code=413, content={"detail": "The file is too large"})


@app.exception_handler(DuplicateTrackError)
async def duplicate_track_handler(_request: Request, _error: DuplicateTrackError) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": "This track is already in the library"})


@app.get("/health", tags=["health"], summary="Check service health")
async def health() -> dict[str, str]:
    storage_ok = settings.downloads_dir.is_dir() and settings.covers_dir.is_dir()
    return {"status": "ok", "storage": "ok" if storage_ok else "warn"}
