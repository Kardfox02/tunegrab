import asyncio
import logging
from pathlib import Path

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class ThumbnailFetchError(Exception):
    """Failed to fetch a YouTube thumbnail from the CDN."""


_THUMBNAIL_URL = "https://i.ytimg.com/vi/{youtube_id}/hqdefault.jpg"


def _write_atomic(path: Path, data: bytes) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


async def get_thumbnail_path(youtube_id: str) -> Path:
    cache_path = settings.thumbnails_dir / f"{youtube_id}.jpg"
    if cache_path.is_file():
        return cache_path

    settings.thumbnails_dir.mkdir(parents=True, exist_ok=True)

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(_THUMBNAIL_URL.format(youtube_id=youtube_id))
            response.raise_for_status()
        data = response.content
    except Exception as exc:
        logger.warning("Thumbnail fetch failed for %s: %s", youtube_id, exc)
        raise ThumbnailFetchError(f"thumbnail fetch failed: {youtube_id}") from exc

    await asyncio.to_thread(_write_atomic, cache_path, data)
    return cache_path
