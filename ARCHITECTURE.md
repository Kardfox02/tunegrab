# Архитектура Tunegrab

## Общее описание

Tunegrab — приложение для загрузки аудио из YouTube с серверной трансляцией музыки и веб-плеером. Рассчитано на двух пользователей.

- **Backend**: Python + FastAPI (запуск через `python.exe`, без виртуального окружения)
- **Frontend**: Vue 3 + Vite (SPA)
- **БД**: SQLite (SQLAlchemy async + aiosqlite) + **Alembic** (миграции)
- **Загрузка аудио**: yt-dlp + ffmpeg (конвертация в mp3; ffmpeg **bundled** — `backend/ffmpeg.exe`, путь переопределяется env `TUNEGRAB_FFMPEG`, иначе — из PATH)

### Статус реализации

| Компонент | Статус |
|---|---|
| Auth (регистрация/логин/logout/change-password/me), JWT-cookie | ✅ реализовано |
| Треки: библиотека, удаление, upload локальных mp3 | ✅ реализовано |
| YouTube: поиск, загрузка, active-список, cancel, retry, прокси превью | ✅ реализовано |
| Stream (Range/206/416/HEAD/ETag) | ✅ реализовано |
| DownloadManager: очередь, state machine, восстановление, отмена | ✅ реализовано |
| Rate limiting, Origin-middleware (CSRF) | ✅ реализовано |
| Модели Playlist/PlaylistTrack/ListenEvent/Like (+ миграции) | ✅ реализовано |
| **API событий `/events`, лайков `/likes`** | ✅ реализовано |
| **API плейлистов, `/shared/{token}`** | ❌ не реализовано (модели готовы) |
| **Слой repositories/** | ❌ не реализован (доступ к данным напрямую в сервисах) |
| **`/health/details`** | ❌ не реализован (есть только публичный `/health`) |
| Frontend | 🚧 в разработке |
| PWA-офлайн | ❌ финальный этап |

## Модель доступа

| Endpoint | Доступ |
|---|---|
| `/auth`, `/health`, `/youtube/thumbnail/{id}`, `/covers/...` | публичные (обложки/превью не секретны) |
| `/tracks`, `/youtube`, `/stream/{id}` | только авторизованные (HttpOnly cookie) |
| `/playlists`, `/shared/{token}`, `/events`, `/recommendations` | 🚧 запланированы (см. статус реализации) |

- **Библиотека треков — общая**: оба пользователя видят все треки.
- **Плейлисты (план)** — личные, расшаривание по ссылке с токеном (read-only), re-share генерирует новый токен.

## Структура проекта

```
tunegrab/
├── backend/
│   ├── app/
│   │   ├── main.py            # Точка входа: FastAPI, lifespan, Origin-middleware, /covers, exception handlers
│   │   ├── config.py          # Frozen Settings: пути, bundled ffmpeg, лимиты, секрет, rate limits
│   │   ├── database.py        # SQLite: WAL, busy_timeout, foreign_keys=ON
│   │   ├── logging_setup.py   # Логирование (файл + консоль)
│   │   ├── storage.py         # Файловое хранилище: пути, resolve-проверка, orphan-скан, cleanup
│   │   ├── cli.py             # python -m app.cli: cleanup-orphans --dry-run, verify-storage
│   │   ├── rate_limit.py      # InMemoryRateLimiter (login 5/60с, youtube search 20/60с → 429)
│   │   ├── middleware/
│   │   │   └── origin.py      # OriginMiddleware: Origin ∈ ALLOWED_ORIGINS для POST/PUT/PATCH/DELETE
│   │   ├── dependencies/
│   │   │   └── auth.py        # get_current_user: cookie → JWT → сверка token_version → User
│   │   ├── models/
│   │   │   ├── base.py        # DeclarativeBase
│   │   │   ├── user.py        # Пользователи (+token_version, created_at)
│   │   │   ├── track.py       # Треки + status + progress, индексы (youtube_id уник., title, author, status+created_at)
│   │   │   ├── playlist.py    # Плейлисты, PlaylistTrack (constraints) — API пока нет
│   │   │   └── event.py       # ListenEvent + Like — API пока нет
│   │   ├── schemas/           # Pydantic-схемы: auth, tracks, youtube
│   │   ├── download/
│   │   │   ├── manager.py     # DownloadManager: asyncio.Queue + 1 worker, cancel-реестр, progress-consumer
│   │   │   └── states.py      # TrackStatus (7 статусов) + ALLOWED_TRANSITIONS
│   │   ├── services/
│   │   │   ├── auth_service.py       # Cookie-сессии, Argon2id, JWT HS256, token_version, change_password
│   │   │   ├── youtube_service.py    # Поиск и метаданные YouTube (yt-dlp через asyncio.to_thread)
│   │   │   ├── track_service.py      # Библиотека, удаление (файл → БД, 409 при блокировке)
│   │   │   ├── stream_service.py     # Range-парсинг (RFC 7233), ETag/Last-Modified, resolve-проверка
│   │   │   ├── upload_service.py     # Локальные mp3: валидация, метаданные (mutagen), обложка
│   │   │   └── thumbnail_service.py  # Прокси YouTube-превью с кэшем (downloads/thumbnails/)
│   │   └── api/
│   │       ├── auth.py       # /auth — register, login, logout, change-password, me
│   │       ├── tracks.py     # /tracks — список (q/sort/пагинация), DELETE, POST /upload
│   │       ├── youtube.py    # /youtube — search, download, downloads/active, status, cancel, retry, thumbnail
│   │       └── stream.py     # /stream/{id} — GET + HEAD, Range-стриминг
│   ├── alembic/               # Миграции: 0001_initial_schema, 0002_active_downloads_index
│   ├── alembic.ini
│   ├── tests/                 # ~40 smoke-тестов (pytest + httpx): auth, stream, tracks, upload, youtube, thumbnails, origin, миграции
│   ├── downloads/             # Аудиофайлы (вне БД)
│   │   ├── covers/            # Обложки (UUID-имена)
│   │   └── thumbnails/        # Кэш проксированных превью
│   ├── ffmpeg.exe             # Bundled ffmpeg (+ ffplay.exe, ffprobe.exe)
│   ├── logs/
│   ├── tunegrab.db
│   ├── secret_key.txt         # JWT-секрет (env TUNEGRAB_SECRET_KEY или атомарная автогенерация)
│   └── requirements.txt       # fastapi, uvicorn, sqlalchemy[asyncio], aiosqlite, alembic, yt-dlp, argon2-cffi, PyJWT, mutagen, python-multipart
└── frontend/                  # 🚧 в разработке
    └── src/
        ├── api/               # HTTP-клиент (withCredentials)
        ├── components/        # PlayerBar, TrackList, ...
        ├── stores/            # Pinia
        └── views/
```

## Слои и принципы

- **presentation** (`api/`) — приём/отдача данных, валидация Pydantic.
- **application** (`services/`, `download/`) — бизнес-логика и оркестрация загрузок.
- **infrastructure** (`database.py`, `storage.py`, `rate_limit.py`) — SQLite, yt-dlp, файловая система.
- **domain** (`models/`, `schemas/`) — сущности и контракты.

DI через `Depends` (`dependencies/auth.py`). Отдельный Repository-слой не выделен — доступ к данным через AsyncSession в сервисах.

**Ограничение развёртывания: сервер запускается строго с одним uvicorn worker** (`--workers 1`) — очереди, cancel-реестр и rate-limiter живут в памяти процесса.

## Сущности БД

- **User** — id, username (уникальный), password_hash (**Argon2id**), `token_version` (int), created_at.
- **Track** (общий):
  - id, youtube_id (**уникальный** — дедупликация, nullable для локальных uploads), title, author, duration;
  - `file_path`, `cover_path` — относительные пути, UUID-имена;
  - `status` — **pending / downloading / converting / finalizing / done / error / cancelled**;
  - `progress` (0–100, контракт ниже), `file_size`, created_at.
  - Индексы: youtube_id (уник.), title, author, **(status, created_at)** — для active-списка (миграция 0002).
  - Метаданные не редактируются после загрузки — endpoint'ов редактирования нет.
- **Playlist** — id, user_id (FK CASCADE), name, `share_token` (UUID, nullable; NULL = приватный). *API — в планах.*
- **PlaylistTrack** — составной PK; UNIQUE(playlist_id, track_id), INDEX(playlist_id, position), ON DELETE CASCADE. *API — в планах.*
- **ListenEvent** — id, user_id, track_id, event_type (**play / skip / complete**), `fraction_played` (Float 0.0–1.0), created_at; INDEX(user_id, track_id). *API — в планах.*
- **Like** — составной PK (user_id, track_id), created_at. *API — в планах.*

### State machine загрузки — допустимые переходы

| Из | В |
|---|---|
| pending | downloading, cancelled, error |
| downloading | converting, cancelled, error |
| converting | finalizing, cancelled, error |
| finalizing | done, cancelled, error |
| done | error (провал проверки целостности) |
| error | pending (retry) |
| cancelled | pending (retry) |

Переходы валидируются `download/states.py` — недопустимый переход невозможен (например, done → downloading).

### Контракт прогресса

`pending`=0, `downloading`=0–80 (маппинг процентов yt-dlp), `converting`=80, `finalizing`=95, `done`=100.

## Аутентификация

- Endpoints: `POST /auth/register` (201, 409 при занятом логине), `POST /auth/login` (rate limit 5/60с → 429), `POST /auth/logout` (204), `GET /auth/me`, `POST /auth/change-password`.
- **Сессия — JWT (HS256) в HttpOnly cookie `tunegrab_session`**: `SameSite=Lax`, `Path=/`, `Secure` в production, TTL 14 дней. Cookie браузер сам шлёт на `/stream` для `<audio>`.
- Payload JWT: `sub`, `token_version`, `iat`, `exp`. При каждой авторизации `token_version` сверяется с БД.
- **CSRF**: Origin-middleware проверяет `Origin ∈ ALLOWED_ORIGINS` для всех POST/PUT/PATCH/DELETE (в dev разрешена private network); **GET-запросы никогда не меняют состояние**.
- **Logout**: удаление cookie + инкремент `token_version` — отзыв всех сессий.
- **`POST /auth/change-password`**: проверка текущего пароля → новый Argon2id-хеш → `token_version++` → свежая cookie.
- **JWT-секрет**: env `TUNEGRAB_SECRET_KEY`, иначе атомарная автогенерация (tmp-файл → `os.replace()`, chmod 600; вне git).
- **Rate limiting** (`rate_limit.py`, in-memory): `/auth/login` 5 req/60с, `/youtube/search` 20 req/60с — по IP, ответ 429.

## Загрузка аудио (DownloadManager)

- Поиск и метаданные — `youtube_service` (yt-dlp через `asyncio.to_thread`, event loop не блокируется).
- **DownloadManager** (`app/download/manager.py`): `asyncio.Queue` + **1 worker**, запускается через lifespan; API лишь кладёт задачу и пишет `status=pending`.
- **Дедупликация**: проверка `youtube_id` до постановки; гонка гасится уникальным индексом + `IntegrityError` (ответ `queued: false`).
- **Атомарность файлов**: yt-dlp пишет в `.{uuid}.part` → ffmpeg (`create_subprocess_exec`, `-codec:a libmp3lame -q:a 0`) конвертирует в `.{uuid}.mp3.tmp` → **`os.replace()`** → только потом `status=done`.
- **Прогресс**: hook в потоке yt-dlp → `call_soon_threadsafe` → async consumer с троттлингом (≥1 сек и ≥1%).
- **Отмена (кооперативная)**: реестр отменённых `track_id`; `POST /youtube/cancel/{track_id}` идемпотентен (done/error/cancelled — no-op); hook прерывает yt-dlp исключением, активные процессы ffmpeg терминируются; `.part` удаляется; статус → `cancelled`.
- **Retry**: `POST /youtube/retry/{id}` — только `error`/`cancelled` → `pending`, иначе **409**.
- **При старте сервера** (`_recover`): `pending` → восстанавливаются в очередь; активные (downloading/converting/finalizing) → `error`; `done` без файла → `error`; временные файлы чистятся; orphan-файлы → warning (удаление — вручную через CLI).
- Проверка ffmpeg (`shutil.which`) при старте — с warning при отсутствии.

### Восстановление загрузок во frontend

`GET /youtube/downloads/active` требует cookie-аутентификацию и возвращает снимок
всех загрузок со статусами `pending`, `downloading`, `converting` и `finalizing`.
Результат сортируется по `created_at ASC`, затем по `id ASC`, чтобы frontend мог
восстанавливать polling в стабильном порядке после перезагрузки страницы или
возврата на вкладку.

Endpoint не изменяет записи и не запускает загрузки. Между запросом active списка
и запросом статуса конкретного трека загрузка может завершиться. Поэтому active
список является только снимком состояния, а последняя выдача
`GET /youtube/{track_id}` является источником истины. Статусы `done`, `error` и
`cancelled` в active список не входят.

## Загрузка локальных файлов

`POST /tracks/upload` (201): только mp3 (422), не пустой (422), ≤100 МБ (413), дедупликация (409).
Метаданные и обложка читаются через **mutagen**; fallback — имя файла. Файл сохраняется атомарно в `downloads/`.

## Стриминг

- `GET /stream/{track_id}` и `HEAD /{track_id}` — только для авторизованных (cookie), библиотека общая.
- Отдача — `StreamingResponse` чанками по 64 КБ; Range-парсинг в `stream_service.py`.
- **Range-логика (RFC 7233)**:

| Ситуация | Ответ |
|---|---|
| Нет `Range` | `200`, весь файл |
| Корректный выполнимый диапазон | `206 Partial Content` |
| Корректный, но невыполнимый (за пределами файла) | **`416`** + `Content-Range: bytes */{size}` |
| Файл отсутствует | `404` |

- Заголовки: `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`, `Content-Type: audio/mpeg`, `ETag`, `Last-Modified`.
- **Path traversal**: путь из БД `resolve()`-ится и проверяется, что внутри `downloads/`, иначе 404.

## Удаление трека

- Порядок: сначала файл (и обложка), затем запись в БД (`DELETE /tracks/{id}` → 204).
- Файл занят (например, Windows-лок при активном стриме) → **`409 Conflict`**, БД не меняется.

## Превью (thumbnails)

`GET /youtube/thumbnail/{youtube_id}` — публичный прокси YouTube-превью: whitelist-regex на id, кэш на диске в `downloads/thumbnails/`, `Cache-Control: public, max-age=604800`, 404 при ошибке загрузки. Поиск (`/youtube/search`) переписывает `thumbnail_url` на этот прокси.

## Рекомендации и события

- **`/events` — реализовано**: `POST /events` (запись события; 404 на несуществующий трек; валидация: enum play/skip/complete, fraction 0.0–1.0, complete ⇒ fraction ≥ 0.9), `GET /events/me/stats` (query-параметр `period_days` 1–30, по умолчанию 7), `GET /events/me/history` (пагинация limit 1–100 / offset).
- **`/likes` — реализовано**: `GET /likes` (пагинация, JOIN tracks, ORDER BY created_at DESC), `GET /likes/ids` (все лайкнутые id текущего пользователя одним лёгким запросом — источник состояния сердечек на фронте, работает независимо от пагинации списка «Любимого»), `PUT /likes/{track_id}` (201 новый / 200 идемпотентный повтор), `DELETE /likes/{track_id}` (204, идемпотентен).
- Правила событий: `play` — при первом старте трека; `complete` — при ended, если фактически прослушанная доля ≥ 0.9; `skip` — при ручном переходе или ended ниже порога. **fraction_played считается по фактическому времени прослушивания** (накопление дельт timeupdate с отсечкой скачков перемотки > 2 с), а не по конечной позиции.
- Статистика (`/events/me/stats`): счётчики play/skip/complete, суммарное время (SUM fraction × duration), **топ-3 трека** с listened_seconds (сумма fraction × duration по всем событиям трека, включая skip/complete — треки выбираются по play через `HAVING SUM(play_weight) > 0`). Период задаётся клиентом (`period_days`, 1–30). Ранжирование топа — по **«затухающему» счёту запусков**: каждый play весит `2^(−возраст_дней / 2)` (полураспад 2 дня, `created_at` и `julianday('now')` — в UTC) — недавние прослушивания поднимаются в топе быстрее старых рекордов; `play_count` и `listened_seconds` в ответе — сырые (невзвешенные).
- Лайки: toggle на фронте (profile.store, оптимистичный с откатом); бэк — идемпотентные PUT/DELETE.
- **Не реализовано**: API плейлистов, рекомендации, `/shared/{token}` (модели в БД готовы).

## Плейлисты и шаринг (план)

- **Не реализовано** — модели Playlist/PlaylistTrack есть в БД, API нет.
- План: CRUD, порядок треков, расшаривание по токену (read-only состав, воспроизведение требует входа), re-share → новый токен.

## Инфраструктура

- **Dev/Prod**: dev — Vite dev-server + proxy на FastAPI; production — FastAPI раздаёт собранную `dist/` (один origin). `production` из env `TUNEGRAB_ENV`, `ALLOWED_ORIGINS` из env.
- **SQLite**: `journal_mode=WAL`, `busy_timeout`, **`foreign_keys=ON`**; миграции — Alembic (0001_initial_schema, 0002_active_downloads_index), не `create_all`.
- **Health**: публичный `GET /health` → `{status, storage: ok|warn}` (проверка `downloads/` и `covers/`); `/health/details` — не реализован.
- **Логирование**: файл + консоль; ошибки, ход загрузки, ключевые действия.
- **Ошибки**: централизованные exception handlers — 404 (TrackNotFound/StreamNotFound), 409 (файл занят, дубликат), 416 (Range), 413 (upload), 422 (Pydantic/upload), 429 (rate limit).
- **Списки**: `q` (≤200), `sort_by` (**enum-белый список**), `order` ∈ {asc, desc}, `limit` 1–100 (дефолт 50), `offset` ≥ 0.
- **CLI**: `python -m app.cli cleanup-orphans [--dry-run]`, `verify-storage`.
- **Тесты**: ~40 smoke-тестов (pytest + httpx) — auth lifecycle, Origin-middleware, stream (Range/416/HEAD/traversal), tracks (CRUD, 409), upload (валидация, дубликаты), youtube (search-моки, дедуп, active-список, state machine, ffmpeg), thumbnails, миграции. Не покрыты: rate limiting, `/health`, будущие плейлисты/события.

## Масштабируемость (~10k треков)

- SQLite с индексами справляется без смены стека; API не отдаёт библиотеку целиком — пагинация + поиск.
- Frontend (план): виртуальный скролл (страницы 50–100), `loading="lazy"` обложек.
- Стриминг читает диапазон файла — от размера библиотеки не зависит.

## Офлайн-режим (PWA, финальный этап)

- Service worker кэширует статику; прослушанные треки — Cache API/IndexedDB.
- Работают: плеер, библиотека, плейлисты. Недоступны: поиск, загрузка, рекомендации.
