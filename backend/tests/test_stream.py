from pathlib import Path

import pytest

from app.models.track import Track
from app.services import stream_service as stream_service_module


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
def audio_file(tmp_path) -> Path:
    path = tmp_path / "audio.mp3"
    path.write_bytes(b"0123456789")
    return path


async def add_track(db_session, audio_file: Path) -> int:
    track = Track(
        youtube_id="stream-track",
        title="Stream track",
        author="Alice",
        file_path="audio.mp3",
        status="done",
    )
    db_session.add(track)
    await db_session.commit()
    return track.id


@pytest.mark.anyio
async def test_stream_requires_authentication(client):
    assert (await client.get("/stream/1")).status_code == 401


@pytest.mark.anyio
async def test_stream_returns_full_file_and_range(client, db_session, audio_file, monkeypatch):
    await register(client)
    track_id = await add_track(db_session, audio_file)
    monkeypatch.setattr(stream_service_module, "resolve_download_path", lambda _path: audio_file)

    response = await client.get(f"/stream/{track_id}")
    assert response.status_code == 200
    assert response.content == b"0123456789"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-length"] == "10"
    assert response.headers["content-type"] == "audio/mpeg"
    assert "etag" in response.headers
    assert "last-modified" in response.headers

    response = await client.get(f"/stream/{track_id}", headers={"Range": "bytes=2-5"})
    assert response.status_code == 206
    assert response.content == b"2345"
    assert response.headers["content-range"] == "bytes 2-5/10"
    assert response.headers["content-length"] == "4"


@pytest.mark.anyio
async def test_stream_rejects_unsatisfiable_range_and_missing_file(client, db_session, audio_file, monkeypatch):
    await register(client)
    track_id = await add_track(db_session, audio_file)
    monkeypatch.setattr(stream_service_module, "resolve_download_path", lambda _path: audio_file)

    response = await client.get(f"/stream/{track_id}", headers={"Range": "bytes=20-30"})
    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */10"

    audio_file.unlink()
    assert (await client.get(f"/stream/{track_id}")).status_code == 404


@pytest.mark.anyio
async def test_stream_head_and_path_traversal(client, db_session, audio_file, monkeypatch):
    await register(client)
    track_id = await add_track(db_session, audio_file)
    safe_resolve = stream_service_module.resolve_download_path
    monkeypatch.setattr(stream_service_module, "resolve_download_path", lambda _path: audio_file)

    response = await client.head(f"/stream/{track_id}")
    assert response.status_code == 200
    assert response.content == b""
    assert response.headers["content-length"] == "10"

    track = await db_session.get(Track, track_id)
    track.file_path = "../outside.mp3"
    await db_session.commit()
    monkeypatch.setattr(stream_service_module, "resolve_download_path", safe_resolve)
    assert (await client.get(f"/stream/{track_id}")).status_code == 404
