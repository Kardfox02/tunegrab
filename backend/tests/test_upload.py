import io
import shutil
import subprocess
from pathlib import Path

import pytest
from mutagen.id3 import APIC, ID3, TIT2, TPE1
from mutagen.mp3 import MP3

from app.config import settings
from app.models.track import Track

ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}


async def register(client):
    response = await client.post(
        "/auth/register",
        json={"username": "alice", "password": "password123"},
        headers=HEADERS,
    )
    assert response.status_code == 201


@pytest.fixture
def storage_dirs(tmp_path):
    downloads = tmp_path / "downloads"
    covers = downloads / "covers"
    downloads.mkdir()
    covers.mkdir()

    originals = {
        "downloads_dir": settings.downloads_dir,
        "covers_dir": settings.covers_dir,
        "max_upload_bytes": settings.max_upload_bytes,
    }
    object.__setattr__(settings, "downloads_dir", downloads)
    object.__setattr__(settings, "covers_dir", covers)
    try:
        yield downloads, covers
    finally:
        for name, value in originals.items():
            object.__setattr__(settings, name, value)


def _generate_silent_mp3(path: Path) -> None:
    ffmpeg = shutil.which("ffmpeg") or settings.ffmpeg_path
    subprocess.run(
        [
            ffmpeg,
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "anullsrc=r=44100:cl=mono",
            "-t",
            "0.2",
            "-b:a",
            "32k",
            str(path),
        ],
        check=True,
        capture_output=True,
    )


def make_mp3_bytes(tmp_path: Path, *, title: str | None = None, author: str | None = None, cover: bytes | None = None) -> bytes:
    path = tmp_path / "sample.mp3"
    _generate_silent_mp3(path)
    audio = MP3(path)
    if audio.tags is None:
        audio.add_tags()
    if title is not None:
        audio.tags.add(TIT2(encoding=3, text=title))
    if author is not None:
        audio.tags.add(TPE1(encoding=3, text=author))
    if cover is not None:
        audio.tags.add(
            APIC(
                encoding=3,
                mime="image/jpeg",
                type=3,
                desc="Cover",
                data=cover,
            )
        )
    audio.save()
    return path.read_bytes()


def upload_files(content: bytes, filename: str = "song.mp3"):
    return {"file": (filename, io.BytesIO(content), "audio/mpeg")}


@pytest.mark.anyio
async def test_upload_requires_authentication(client):
    response = await client.post(
        "/tracks/upload",
        files=upload_files(b"audio"),
        headers=HEADERS,
    )
    assert response.status_code == 401


@pytest.mark.anyio
async def test_upload_rejects_non_mp3(client, storage_dirs):
    await register(client)

    response = await client.post(
        "/tracks/upload",
        files={"file": ("song.txt", io.BytesIO(b"data"), "text/plain")},
        headers=HEADERS,
    )

    assert response.status_code == 422


@pytest.mark.anyio
async def test_upload_rejects_empty_file(client, storage_dirs):
    await register(client)

    response = await client.post(
        "/tracks/upload",
        files={"file": ("song.mp3", io.BytesIO(b""), "audio/mpeg")},
        headers=HEADERS,
    )

    assert response.status_code == 422


@pytest.mark.anyio
async def test_upload_stores_file_metadata_and_cover(client, db_session, storage_dirs, tmp_path):
    await register(client)
    downloads, covers = storage_dirs
    cover_bytes = b"\xff\xd8\xff\xe0fakejpeg"
    content = make_mp3_bytes(tmp_path, title="My Song", author="Me", cover=cover_bytes)

    response = await client.post(
        "/tracks/upload",
        files=upload_files(content),
        headers=HEADERS,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "My Song"
    assert body["author"] == "Me"
    assert body["status"] == "done"
    assert body["progress"] == 100
    assert body["file_size"] == len(content)
    assert body["cover_url"] is not None

    await db_session.rollback()
    track = await db_session.get(Track, body["id"])
    assert track is not None
    stored_file = downloads / track.file_path
    assert stored_file.read_bytes() == content
    stored_cover = covers / Path(track.cover_path).name
    assert stored_cover.read_bytes() == cover_bytes


@pytest.mark.anyio
async def test_upload_falls_back_to_filename_metadata(client, db_session, storage_dirs, tmp_path):
    await register(client)
    content = make_mp3_bytes(tmp_path)

    response = await client.post(
        "/tracks/upload",
        files={"file": ("Cool Artist - My Song.mp3", io.BytesIO(content), "audio/mpeg")},
        headers=HEADERS,
    )

    assert response.status_code == 201
    body = response.json()
    assert body["title"] == "Cool Artist - My Song"
    assert body["author"] == "Cool Artist"
    assert body["cover_url"] is None


@pytest.mark.anyio
async def test_upload_duplicate_returns_conflict(client, storage_dirs, tmp_path):
    await register(client)
    content = make_mp3_bytes(tmp_path)

    first = await client.post("/tracks/upload", files=upload_files(content), headers=HEADERS)
    second = await client.post("/tracks/upload", files=upload_files(content), headers=HEADERS)

    assert first.status_code == 201
    assert second.status_code == 409


@pytest.mark.anyio
async def test_upload_too_large_returns_413(client, storage_dirs, tmp_path):
    await register(client)
    object.__setattr__(settings, "max_upload_bytes", 10)
    try:
        content = make_mp3_bytes(tmp_path)
        response = await client.post("/tracks/upload", files=upload_files(content), headers=HEADERS)
    finally:
        object.__setattr__(settings, "max_upload_bytes", 100 * 1024 * 1024)

    assert response.status_code == 413
