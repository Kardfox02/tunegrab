"""Раздача собранного SPA (frontend/dist) самим бэкендом.

Единый процесс эксплуатации: FastAPI отдаёт и API, и фронт.
Mount /assets — хешированные ассеты с immutable-кэшем; корневые файлы dist
(favicon, manifest, темы) — без кэша; catch-all GET/HEAD — SPA fallback
на index.html для deep-links (/library, /playlists/5, /shared/token).
Если dist отсутствует, раздача не включается — бэк работает как чистый API
(dev-режим через Vite proxy).
"""

import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

logger = logging.getLogger(__name__)

INDEX_CACHE_HEADERS = {"Cache-Control": "no-cache"}
ASSET_CACHE_HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}

# Первые сегменты, зарезервированные за API: не совпавший путь внутри них
# означает реальный 404 API-роута — SPA fallback не должен маскировать его
# страницей index.html (иначе клиенты видят 200 HTML вместо 404 JSON).
RESERVED_API_PREFIXES = frozenset(
    {
        "auth",
        "tracks",
        "youtube",
        "stream",
        "events",
        "likes",
        "playlists",
        "admin",
        "health",
        "covers",
        "assets",
    }
)


class SpaNavigationMiddleware(BaseHTTPMiddleware):
    """Навигация браузера уходит в SPA до маршрутизации.

    Часть SPA-путей коллидирует с API (/playlists/{id} — одновременно и
    REST-роут, и страница фронтенда). Без этого middleware GET /playlists/5
    отвечал бы JSON плейлиста (или 401) вместо страницы. Механизм тот же,
    что у bypass в Vite-proxy dev-режима: запрос с Accept: text/html —
    навигация браузера (axios/fetch присылают application/json), ему
    отдаётся index.html, дальнейшая маршрутизация — на стороне клиента.
    """

    def __init__(self, app, index_path: Path) -> None:
        super().__init__(app)
        self.index_response = FileResponse(index_path, headers=INDEX_CACHE_HEADERS)

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method in {"GET", "HEAD"} and "text/html" in request.headers.get("accept", ""):
            return self.index_response
        return await call_next(request)


def _serve_file(path: Path, cache_headers: dict[str, str]) -> FileResponse:
    return FileResponse(path, headers=cache_headers)


def _spa_response(dist_dir: Path) -> FileResponse:
    return _serve_file(dist_dir / "index.html", INDEX_CACHE_HEADERS)


def _is_safe_root_file(dist_dir: Path, filename: str) -> bool:
    """Корневой файл dist: без вложенности — traversal исключён структурой."""
    candidate = (dist_dir / filename).resolve()
    return candidate.is_file() and candidate.parent == dist_dir.resolve()


def mount_frontend(app: FastAPI, dist_dir: Path) -> bool:
    """Подключает раздачу собранного фронта. Возвращает факт подключения.

    Вызывается после регистрации всех API-роутеров и mount /covers —
    они выигрывают у catch-all по порядку матчинга Starlette.
    """
    index_path = dist_dir / "index.html"
    if not index_path.is_file():
        logger.info("Frontend dist not found (%s) — serving API only", dist_dir)
        return False

    assets_dir = dist_dir / "assets"
    if assets_dir.is_dir():

        class CachedStaticFiles(StaticFiles):
            """StaticFiles с Cache-Control: хешированные имена — кэш вечный."""

            async def get_response(self, path: str, scope):  # type: ignore[override]
                response = await super().get_response(path, scope)
                response.headers.update(ASSET_CACHE_HEADERS)
                return response

        app.mount("/assets", CachedStaticFiles(directory=assets_dir), name="frontend-assets")

    # Навигация в SPA — до всей маршрутизации (см. docstring middleware):
    # последний добавленный middleware выполняется первым.
    app.add_middleware(SpaNavigationMiddleware, index_path=index_path)

    # Корневые файлы dist (favicon, manifest, темы, icons): имена не хешируются —
    # отдаются без кэша, чтобы обновление подхватилось сразу.
    known_root_files = {
        item.name: INDEX_CACHE_HEADERS
        for item in sorted(dist_dir.iterdir())
        if item.is_file() and item.name != "index.html"
    }

    @app.get("/{full_path:path}", include_in_schema=False, response_model=None)
    async def spa_fallback(request: Request, full_path: str) -> Response:
        # Starlette автоматически разрешает HEAD для GET-маршрута.
        clean_path = full_path.rstrip("/")
        segments = [segment for segment in clean_path.split("/") if segment]

        # Путь внутри API-пространства: маршрут не совпал — реальный 404.
        if segments and segments[0] in RESERVED_API_PREFIXES:
            return JSONResponse(status_code=404, content={"detail": "Not found"})

        # Traversal-сегменты не превращаются в SPA-страницу.
        if any(segment == ".." for segment in segments):
            return JSONResponse(status_code=404, content={"detail": "Not found"})

        # Deep-link или корень: путь без расширения → SPA-страница.
        if not segments:
            return _spa_response(dist_dir)

        first = segments[0]
        if len(segments) == 1 and first in known_root_files and _is_safe_root_file(dist_dir, first):
            return _serve_file((dist_dir / first).resolve(), known_root_files[first])

        last = segments[-1]
        if "." not in last:
            return _spa_response(dist_dir)

        # Несуществующий ассет (.js/.css/...) не должен притворяться страницей —
        # отдам 404, чтобы консоль браузера показала реальную проблему.
        return JSONResponse(status_code=404, content={"detail": "Asset not found"})

    logger.info("Serving frontend from %s", dist_dir)
    return True
