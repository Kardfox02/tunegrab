import asyncio
import hashlib
import logging
import os
import uuid
from pathlib import Path

from mutagen.id3 import ID3
from mutagen.mp3 import MP3
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.track import Track

logger = logging.getLogger(__name__)


class UploadValidationError(Exception):
    """The uploaded file is empty or not an mp3."""


class UploadTooLargeError(Exception):
    """The uploaded file exceeds the configured size limit."""


class DuplicateTrackError(Exception):
    """An identical file already exists in the library."""


def _filename_title(filename: str) -> str:
    stem = Path(filename).stem.strip()
    return stem or "Без названия"


def _filename_author(filename: str) -> str:
    stem = Path(filename).stem
    for separator in (" - ", " — ", " – "):
        if separator in stem:
            return stem.split(separator, 1)[0].strip() or "Неизвестный исполнитель"
    return "Неизвестный исполнитель"


def _parse_metadata_sync(path: Path, filename: str) -> tuple[str, str, float | None, bytes | None]:
    title = _filename_title(filename)
    author = _filename_author(filename)
    duration: float | None = None
    cover: bytes | None = None

    try:
        audio = MP3(path)
    except Exception:
        audio = None
    if audio is not None and audio.info is not None:
        duration = audio.info.length

    try:
        tags = ID3(path)
    except Exception:
        tags = None
    if tags is not None:
        frame = tags.get("TIT2")
        if frame is not None and str(frame.text[0]).strip():
            title = str(frame.text[0]).strip()
        frame = tags.get("TPE1")
        if frame is not None and str(frame.text[0]).strip():
            author = str(frame.text[0]).strip()
        for picture in tags.getall("APIC"):
            cover = picture.data
            break

    return title, author, duration, cover


def _store_cover_sync(data: bytes) -> Path:
    extension = ".jpg" if data.startswith(b"\xff\xd8\xff") else ".png"
    cover_path = settings.covers_dir / f"{uuid.uuid4().hex}{extension}"
    temporary = cover_path.with_suffix(".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, cover_path)
    return cover_path


async def upload_track(session: AsyncSession, *, filename: str, content: bytes) -> Track:
    if not filename.lower().endswith(".mp3"):
        raise UploadValidationError("Only mp3 files are supported")
    if len(content) == 0:
        raise UploadValidationError("The file is empty")
    if len(content) > settings.max_upload_bytes:
        raise UploadTooLargeError("The file is too large")

    digest = hashlib.sha256(content).hexdigest()
    youtube_id = f"local_{digest[:26]}"

    existing = await session.scalar(select(Track).where(Track.youtube_id == youtube_id))
    if existing is not None:
        raise DuplicateTrackError("This track is already in the library")

    title, author, duration, cover = await asyncio.to_thread(
        _extract_metadata_sync, content, filename
    )

    final_path = settings.downloads_dir / f"{uuid.uuid4().hex}.mp3"
    cover_relative: str | None = None
    published = False
    try:
        await asyncio.to_thread(_write_file_atomic_sync, content, final_path)
        if cover is not None:
            cover_path = await asyncio.to_thread(_store_cover_sync, cover)
            cover_relative = str(cover_path.relative_to(settings.downloads_dir))

        track = Track(
            youtube_id=youtube_id,
            title=title,
            author=author,
            duration=duration,
            file_path=str(final_path.relative_to(settings.downloads_dir)),
            cover_path=cover_relative,
            status="done",
            progress=100,
            file_size=len(content),
        )
        session.add(track)
        try:
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise DuplicateTrackError("This track is already in the library") from None
        published = True
        return track
    finally:
        if not published:
            final_path.unlink(missing_ok=True)


def _write_file_atomic_sync(content: bytes, target: Path) -> None:
    temporary = target.with_suffix(".tmp")
    temporary.write_bytes(content)
    os.replace(temporary, target)


def _extract_metadata_sync(content: bytes, filename: str):
    temporary = settings.downloads_dir / f".{uuid.uuid4().hex}.meta.tmp"
    try:
        temporary.write_bytes(content)
        return _parse_metadata_sync(temporary, filename)
    finally:
        temporary.unlink(missing_ok=True)
