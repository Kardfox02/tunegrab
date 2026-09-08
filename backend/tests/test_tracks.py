from pathlib import Path

import pytest

from app.models.track import Track
from app.services import track_service as track_service_module


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
async def test_tracks_require_authentication(client):
    assert (await client.get("/tracks")).status_code == 401
    assert (await client.delete("/tracks/1", headers=HEADERS)).status_code == 401


@pytest.mark.anyio
async def test_tracks_list_search_sort_and_pagination(client, db_session):
    await register(client)
    db_session.add_all(
        [
            Track(youtube_id="first", title="Blue Song", author="Alice", status="done"),
            Track(youtube_id="second", title="Red Song", author="Bob", status="done"),
            Track(youtube_id="third", title="Blue Sky", author="Carol", status="done"),
        ]
    )
    await db_session.commit()

    response = await client.get(
        "/tracks",
        params={"q": "blue", "sort_by": "title", "order": "asc", "limit": 1, "offset": 1},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["limit"] == 1
    assert body["items"][0]["title"] == "Blue Song"


@pytest.mark.anyio
async def test_tracks_reject_invalid_pagination_and_sort(client):
    await register(client)

    assert (await client.get("/tracks", params={"limit": 101})).status_code == 422
    assert (await client.get("/tracks", params={"offset": -1})).status_code == 422
    assert (await client.get("/tracks", params={"sort_by": "youtube_id"})).status_code == 422


@pytest.mark.anyio
async def test_delete_track_removes_files_and_record(client, db_session, tmp_path, monkeypatch):
    await register(client)
    audio_path = tmp_path / "audio.mp3"
    cover_path = tmp_path / "cover.jpg"
    audio_path.write_bytes(b"audio")
    cover_path.write_bytes(b"cover")

    def resolve(path: str) -> Path:
        return {"audio.mp3": audio_path, "cover.jpg": cover_path}[path]

    monkeypatch.setattr(track_service_module, "resolve_download_path", resolve)
    track = Track(
        youtube_id="deletable",
        title="Delete me",
        author="Alice",
        file_path="audio.mp3",
        cover_path="cover.jpg",
        status="done",
    )
    db_session.add(track)
    await db_session.commit()
    track_id = track.id

    response = await client.delete(f"/tracks/{track_id}", headers=HEADERS)

    assert response.status_code == 204
    assert not audio_path.exists()
    assert not cover_path.exists()
    await db_session.rollback()
    db_session.expire_all()
    assert await db_session.get(Track, track_id) is None


@pytest.mark.anyio
async def test_delete_missing_track_returns_not_found(client):
    await register(client)

    response = await client.delete("/tracks/999", headers=HEADERS)

    assert response.status_code == 404


@pytest.mark.anyio
async def test_delete_busy_file_keeps_record(client, db_session, tmp_path, monkeypatch):
    await register(client)
    audio_path = tmp_path / "audio.mp3"
    audio_path.write_bytes(b"audio")

    def resolve(_path: str) -> Path:
        return audio_path

    def busy_unlink(_path):
        raise PermissionError("file is busy")

    monkeypatch.setattr(track_service_module, "resolve_download_path", resolve)
    monkeypatch.setattr(Path, "unlink", busy_unlink)
    track = Track(
        youtube_id="busy",
        title="Busy",
        author="Alice",
        file_path="audio.mp3",
        status="done",
    )
    db_session.add(track)
    await db_session.commit()
    track_id = track.id

    response = await client.delete(f"/tracks/{track_id}", headers=HEADERS)

    assert response.status_code == 409
    assert await db_session.get(Track, track_id) is not None
