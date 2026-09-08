import uuid

import httpx
import pytest


ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}


async def register(client):
    response = await client.post(
        "/auth/register",
        json={"username": "alice", "password": "password123"},
        headers=HEADERS,
    )
    assert response.status_code == 201


def unique_id() -> str:
    return "t" + uuid.uuid4().hex[:12]


@pytest.mark.anyio
async def test_thumbnail_proxies_from_cdn_and_caches(client, monkeypatch):
    await register(client)
    youtube_id = unique_id()
    calls = []

    async def fake_get(self, url, **kwargs):
        if "i.ytimg.com" not in url:
            return await original_get(self, url, **kwargs)
        calls.append(url)
        return type("Response", (), {"content": b"jpeg-bytes", "raise_for_status": lambda inner: None})()

    original_get = httpx.AsyncClient.get
    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    first = await client.get(f"/youtube/thumbnail/{youtube_id}")
    assert first.status_code == 200
    assert first.headers["content-type"] == "image/jpeg"
    assert first.content == b"jpeg-bytes"
    assert "max-age=604800" in first.headers["cache-control"]
    assert "i.ytimg.com" in calls[0]

    second = await client.get(f"/youtube/thumbnail/{youtube_id}")
    assert second.status_code == 200
    assert second.content == b"jpeg-bytes"
    assert len(calls) == 1


@pytest.mark.anyio
async def test_thumbnail_rejects_invalid_id(client):
    await register(client)
    response = await client.get("/youtube/thumbnail/bad..id")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_thumbnail_returns_404_when_fetch_fails(client, monkeypatch):
    await register(client)
    youtube_id = unique_id()

    async def failing_get(self, url, **kwargs):
        if "i.ytimg.com" not in url:
            return await original_get(self, url, **kwargs)
        raise httpx.ConnectError("cdn unreachable")

    original_get = httpx.AsyncClient.get
    monkeypatch.setattr(httpx.AsyncClient, "get", failing_get)
    response = await client.get(f"/youtube/thumbnail/{youtube_id}")
    assert response.status_code == 404


@pytest.mark.anyio
async def test_search_returns_proxied_thumbnail_url(client, monkeypatch):
    from app.api import youtube as youtube_api
    from app.services import youtube_service

    await register(client)

    async def fake_search(query, limit):
        return [
            youtube_service.YouTubeResult(
                youtube_id="abc123",
                title="Song",
                author="Artist",
                duration=12.5,
                thumbnail_url="https://i.ytimg.com/vi/abc123/hqdefault.jpg",
                webpage_url="https://youtube.com/watch?v=abc123",
            )
        ]

    monkeypatch.setattr(youtube_api.youtube_service, "search", fake_search)
    response = await client.get("/youtube/search", params={"q": "song"})

    assert response.status_code == 200
    assert response.json()["items"][0]["thumbnail_url"] == "/youtube/thumbnail/abc123"
