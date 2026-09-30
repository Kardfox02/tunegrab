"""Smoke-тесты раздачи собранного SPA бэкендом и same-origin политики."""

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.responses import PlainTextResponse

from app.main import app
from app.middleware.origin import OriginMiddleware
from app.static_site import mount_frontend


@pytest.mark.anyio
async def test_root_serves_index_html(client):
    response = await client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert response.headers["cache-control"] == "no-cache"
    # Собранная SPA: div монтирования и модульный скрипт.
    assert "id=\"app\"" in response.text


@pytest.mark.anyio
async def test_browser_navigation_returns_spa_page(client):
    # Часть SPA-путей коллидирует с API (/playlists/{id}); запрос с Accept:
    # text/html — навигация браузера — уходит в SPA до маршрутизации.
    response = await client.get("/playlists/5", headers={"Accept": "text/html"})
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


@pytest.mark.anyio
async def test_api_request_keeps_api_contract(client):
    # Тот же путь без Accept: text/html — чистый API-запрос: контракт сохранён
    # (аноним получает 401 JSON, а не SPA-страницу).
    response = await client.get("/playlists/5", headers={"Accept": "application/json"})
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/json")


@pytest.mark.anyio
async def test_unknown_asset_returns_404_json(client):
    response = await client.get("/nonexistent-chunk.js")
    assert response.status_code == 404
    assert response.json() == {"detail": "Asset not found"}


@pytest.mark.anyio
async def test_reserved_api_prefix_does_not_mask_as_spa(client):
    # Не совпавший путь внутри API-пространства — реальный 404, не index.html.
    response = await client.get("/auth/unknown-endpoint")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


@pytest.mark.anyio
async def test_missing_assets_mount_answers_404_not_spa(client):
    response = await client.get("/assets/no-such-chunk-abcdef.js")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


@pytest.mark.anyio
async def test_root_dist_files_are_served(client):
    response = await client.get("/manifest.webmanifest")
    assert response.status_code == 200
    response = await client.get("/favicon.png")
    assert response.status_code == 200


@pytest.mark.anyio
async def test_path_traversal_is_denied(client):
    response = await client.get("/..%2F..%2Fetc%2Fpasswd")
    assert response.status_code in (404, 400)


@pytest.mark.anyio
async def test_mount_frontend_returns_false_without_dist(tmp_path):
    fresh_app = type(app)(title="Fresh")
    connected = mount_frontend(fresh_app, tmp_path / "missing-dist")
    assert connected is False


async def same_origin_endpoint(_scope, _receive, send):
    response = PlainTextResponse("ok")
    await response(_scope, _receive, send)


@pytest.mark.anyio
async def test_same_origin_post_is_allowed_even_outside_allow_list():
    # Фронт отдаётся самим бэкендом: Origin совпадает с Host запроса —
    # POST пропускается, хотя origin нет в allow-list (CSRF-защита сохранена).
    middleware = OriginMiddleware(
        same_origin_endpoint,
        allowed_origins=("http://localhost:5173",),
        allow_private_network=False,
    )
    async with AsyncClient(transport=ASGITransport(app=middleware), base_url="http://music.example") as client:
        same = await client.post("/", headers={"Origin": "http://music.example"})
        foreign = await client.post("/", headers={"Origin": "http://evil.example"})
        no_origin = await client.post("/")

    assert same.status_code == 200
    assert foreign.status_code == 403
    assert no_origin.status_code == 403


@pytest.mark.anyio
async def test_same_origin_respects_forwarded_proto():
    # TLS-терминация перед nginx/proxy: X-Forwarded-Proto определяет схему.
    middleware = OriginMiddleware(
        same_origin_endpoint,
        allowed_origins=(),
        allow_private_network=False,
    )
    async with AsyncClient(transport=ASGITransport(app=middleware), base_url="http://music.example") as client:
        mismatch = await client.post(
            "/", headers={"Origin": "https://music.example", "X-Forwarded-Proto": "http"},
        )
        match = await client.post(
            "/", headers={"Origin": "https://music.example", "X-Forwarded-Proto": "https"},
        )

    assert mismatch.status_code == 403
    assert match.status_code == 200


@pytest.mark.anyio
async def test_live_app_accepts_same_origin_register(client):
    # Интеграционный срез: POST на живом приложении с Origin=Host проходит
    # middleware (registrация может вернуть 4xx по своим причинам — важно не 403).
    response = await client.post(
        "/auth/register", json={"username": "so-user", "password": "longpassword"},
        headers={"Origin": "http://test"},
    )
    assert response.status_code != 403
