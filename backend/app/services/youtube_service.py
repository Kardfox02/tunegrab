import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class YouTubeResult:
    youtube_id: str
    title: str
    author: str
    duration: float | None
    thumbnail_url: str | None
    webpage_url: str


def _search_sync(query: str, limit: int) -> list[YouTubeResult]:
    import yt_dlp

    options = {
        "quiet": True,
        "skip_download": True,
        "extract_flat": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(f"ytsearch{limit}:{query}", download=False)
    results: list[YouTubeResult] = []
    for entry in (info or {}).get("entries", []):
        if not entry or not entry.get("id"):
            continue
        results.append(
            YouTubeResult(
                youtube_id=str(entry["id"]),
                title=str(entry.get("title") or "Untitled"),
                author=str(entry.get("uploader") or entry.get("channel") or "Unknown"),
                duration=entry.get("duration"),
                thumbnail_url=entry.get("thumbnail"),
                webpage_url=str(entry.get("webpage_url") or f"https://www.youtube.com/watch?v={entry['id']}"),
            )
        )
    return results


async def search(query: str, limit: int) -> list[YouTubeResult]:
    return await asyncio.to_thread(_search_sync, query, limit)


def _download_sync(url: str, output_template: str, progress_hook: Any) -> None:
    import yt_dlp

    options = {
        "quiet": True,
        "noplaylist": True,
        "format": "bestaudio/best",
        "outtmpl": output_template,
        "progress_hooks": [progress_hook],
        "writethumbnail": True,
        "restrictfilenames": True,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        downloader.download([url])


async def download(url: str, output_template: str, progress_hook: Any) -> None:
    await asyncio.to_thread(_download_sync, url, output_template, progress_hook)
