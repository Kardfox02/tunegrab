import asyncio
import math
import struct
import wave
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from app.api import youtube as youtube_api
from app.download.manager import DownloadManager
from app.download.states import InvalidTrackTransitionError, TrackStatus, transition_status
from app.models.track import Track
from app.services import youtube_service


ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}


async def register(client):
    response = await client.post(
        "/auth/register",
        json={"username": "alice", "password": "password123"},
        headers=HEADERS,
    )
    assert response.status_code == 201


@pytest.mark.anyio
async def test_youtube_search_uses_service_without_download(client, monkeypatch):
    await register(client)
    calls = []

    async def fake_search(query, limit):
        calls.append((query, limit))
        return [
            youtube_service.YouTubeResult(
                youtube_id="abc123",
                title="Song",
                author="Artist",
                duration=12.5,
                thumbnail_url=None,
                webpage_url="https://youtube.com/watch?v=abc123",
            )
        ]

    monkeypatch.setattr(youtube_api.youtube_service, "search", fake_search)
    response = await client.get("/youtube/search", params={"q": " song ", "limit": 3})

    assert response.status_code == 200
    assert response.json()["items"][0]["youtube_id"] == "abc123"
    assert calls == [("song", 3)]


@pytest.mark.anyio
async def test_youtube_download_deduplicates_parallel_requests(client, db_session):
    await register(client)
    payload = {
        "youtube_id": "same-id",
        "title": "Song",
        "author": "Artist",
        "duration": 30,
    }

    responses = await asyncio.gather(
        client.post("/youtube/download", json=payload, headers=HEADERS),
        client.post("/youtube/download", json=payload, headers=HEADERS),
    )

    assert all(response.status_code == 202 for response in responses)
    tracks = (await db_session.scalars(select(Track).where(Track.youtube_id == "same-id"))).all()
    assert len(tracks) == 1


@pytest.mark.anyio
async def test_active_downloads_require_authentication(client):
    response = await client.get("/youtube/downloads/active")

    assert response.status_code == 401


@pytest.mark.anyio
async def test_active_downloads_returns_empty_list(client):
    await register(client)

    response = await client.get("/youtube/downloads/active")

    assert response.status_code == 200
    assert response.json() == {"items": []}


@pytest.mark.anyio
async def test_active_downloads_filters_terminal_statuses(client, db_session):
    await register(client)
    statuses = ["pending", "downloading", "converting", "finalizing", "done", "error", "cancelled"]
    db_session.add_all(
        [
            Track(youtube_id=f"status-{status}", title=status, author="Artist", status=status)
            for status in statuses
        ]
    )
    await db_session.commit()

    response = await client.get("/youtube/downloads/active")

    assert response.status_code == 200
    assert [item["status"] for item in response.json()["items"]] == statuses[:4]


@pytest.mark.anyio
async def test_active_downloads_does_not_change_track_state(client, db_session):
    await register(client)
    track = Track(
        youtube_id="unchanged",
        title="Track",
        author="Artist",
        status="downloading",
        progress=37.4,
    )
    db_session.add(track)
    await db_session.commit()
    track_id = track.id

    response = await client.get("/youtube/downloads/active")

    assert response.status_code == 200
    await db_session.refresh(track)
    assert track.id == track_id
    assert track.status == "downloading"
    assert track.progress == 37.4


@pytest.mark.anyio
async def test_active_downloads_sort_by_created_at_then_id(client, db_session):
    await register(client)
    timestamp = datetime(2026, 9, 4, 20, 15, 0)
    first = Track(
        youtube_id="sort-first",
        title="First",
        author="Artist",
        status="pending",
        created_at=timestamp,
    )
    second = Track(
        youtube_id="sort-second",
        title="Second",
        author="Artist",
        status="downloading",
        created_at=timestamp,
    )
    older = Track(
        youtube_id="sort-older",
        title="Older",
        author="Artist",
        status="converting",
        created_at=datetime(2026, 9, 3, 20, 15, 0),
    )
    db_session.add_all([first, second, older])
    await db_session.commit()

    response = await client.get("/youtube/downloads/active")

    assert [item["youtube_id"] for item in response.json()["items"]] == [
        "sort-older",
        "sort-first",
        "sort-second",
    ]


@pytest.mark.anyio
@pytest.mark.parametrize("terminal_status", ["done", "cancelled", "error"])
async def test_active_downloads_excludes_track_after_terminal_status(
    client,
    db_session,
    terminal_status,
):
    await register(client)
    track = Track(
        youtube_id=f"terminal-{terminal_status}",
        title="Track",
        author="Artist",
        status="pending",
    )
    db_session.add(track)
    await db_session.commit()

    active_response = await client.get("/youtube/downloads/active")
    assert [item["id"] for item in active_response.json()["items"]] == [track.id]

    track.status = terminal_status
    await db_session.commit()

    terminal_response = await client.get("/youtube/downloads/active")
    assert terminal_response.json() == {"items": []}


@pytest.mark.anyio
async def test_track_response_uses_public_cover_url(client, db_session):
    await register(client)
    track = Track(
        youtube_id="cover-url",
        title="Track",
        author="Artist",
        status="done",
        cover_path="covers/abc.jpg",
    )
    db_session.add(track)
    await db_session.commit()

    response = await client.get(f"/youtube/{track.id}")

    assert response.status_code == 200
    body = response.json()
    assert body["cover_url"] == "/covers/abc.jpg"
    assert "file_path" not in body
    assert "cover_path" not in body


def test_track_state_machine_rejects_invalid_transition():
    assert transition_status("pending", TrackStatus.DOWNLOADING) == TrackStatus.DOWNLOADING
    assert transition_status("error", TrackStatus.PENDING) == TrackStatus.PENDING
    with pytest.raises(InvalidTrackTransitionError):
        transition_status("done", TrackStatus.DOWNLOADING)


def _write_wav(path: Path, seconds: float = 0.3) -> None:
    sample_rate = 8000
    frames = int(sample_rate * seconds)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        handle.writeframes(
            b"".join(
                struct.pack("<h", int(12000 * math.sin(2 * math.pi * 440 * i / sample_rate)))
                for i in range(frames)
            )
        )


@pytest.mark.anyio
async def test_run_ffmpeg_converts_to_mp3_despite_tmp_extension(tmp_path):
    source = tmp_path / "audio.wav"
    _write_wav(source)
    target = tmp_path / ".output.mp3.tmp"

    await DownloadManager()._run_ffmpeg(1, source, target)

    assert target.is_file()
    assert target.stat().st_size > 0


@pytest.mark.anyio
async def test_run_ffmpeg_failure_raises_runtime_error(tmp_path):
    manager = DownloadManager()

    with pytest.raises(RuntimeError, match="ffmpeg conversion failed"):
        await manager._run_ffmpeg(1, tmp_path / "missing.webm", tmp_path / ".output.mp3.tmp")
