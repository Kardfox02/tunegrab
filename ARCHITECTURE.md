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
| API событий `/events`, лайков `/likes` | ✅ реализовано |
| API плейлистов `/playlists` (+ публичный `/playlists/shared/{token}`) | ✅ реализовано |
| Админ-панель: `/admin/health`, очистка thumbnails, команды CLI | ✅ реализовано |
| Слой repositories/ | ❌ не реализован (доступ к данным напрямую в сервисах) |
| `/health/details` | ❌ не реализован (есть только публичный `/health`) |
| Frontend | ✅ реализован (см. ARCHITECTURE_FRONT.md) |

## Модель доступа

| Endpoint | Доступ |
|---|---|
| `/auth`, `/health`, `/covers/...` | публичные (обложки не секретны) |
| `/playlists/shared/{token}` | публичный (метаданные плейлиста без стриминга) |
| `/tracks`, `/youtube` (включая thumbnail), `/stream/{id}` | только авторизованные (HttpOnly cookie) |
| `/events`, `/likes`, `/playlists`, `/playlists/shared/{token}/subscribe` | только авторизованные (HttpOnly cookie) |

- **Библиотека треков — общая**: оба пользователя видят все треки.

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
│   │   │   ├── playlist.py    # Плейлисты, PlaylistTrack (constraints)
│   │   │   └── event.py       # ListenEvent + Like
│   │   ├── schemas/           # Pydantic-схемы: auth, tracks, youtube, events, likes, playlists, admin
│   │   ├── download/
│   │   │   ├── manager.py     # DownloadManager: asyncio.Queue + 1 worker, cancel-реестр, progress-consumer
│   │   │   └── states.py      # TrackStatus (7 статусов) + ALLOWED_TRANSITIONS
│   │   ├── services/
│   │   │   ├── auth_service.py       # Cookie-сессии, Argon2id, JWT HS256, token_version, change_password
│   │   │   ├── youtube_service.py    # Поиск и метаданные YouTube (yt-dlp через asyncio.to_thread)
│   │   │   ├── track_service.py      # Библиотека, удаление (файл → БД, 409 при блокировке)
│   │   │   ├── stream_service.py     # Range-парсинг (RFC 7233), ETag/Last-Modified, resolve-проверка
│   │   │   ├── upload_service.py     # Локальные mp3: валидация, метаданные (mutagen), обложка
│   │   │   ├── thumbnail_service.py  # Прокси YouTube-превью с кэшем (downloads/thumbnails/)
│   │   │   ├── event_service.py      # События прослушиваний, статистика (затухающий топ), история
│   │   │   ├── like_service.py       # Лайки: список с пагинацией, ids, идемпотентные PUT/DELETE
│   │   │   ├── playlist_service.py   # Плейлисты: CRUD, позиции (max+1, компактизация), reorder, share-токены
│   │   │   └── admin_service.py      # Админ-панель: health с размерами хранилища, очистка thumbnails, команды CLI
│   │   └── api/
│   │       ├── auth.py       # /auth — register, login, logout, change-password, me
│   │       ├── tracks.py     # /tracks — список (q/sort/пагинация), DELETE, POST /upload
│   │       ├── youtube.py    # /youtube — search, download, downloads/active, status, cancel, retry, thumbnail
│   │       ├── stream.py     # /stream/{id} — GET + HEAD, Range-стриминг
│   │       ├── events.py     # /events — POST, stats, history
│   │       ├── likes.py      # /likes — список, ids, PUT, DELETE
│   │       ├── playlists.py  # /playlists — CRUD, треки, order, share, публичный shared/{token}
│   │       └── admin.py      # /admin — health, thumbnails/clear, commands (verify-storage, cleanup-orphans)
│   ├── alembic/               # Миграции: 0001_initial_schema, 0002_active_downloads_index, 0003_playlist_access
│   ├── alembic.ini
│   ├── tests/                 # ~68 smoke-тестов (pytest + httpx): auth, stream, tracks, upload, youtube, thumbnails, origin, events, likes, playlists, миграции
│   ├── downloads/             # Аудиофайлы (вне БД)
│   │   ├── covers/            # Обложки (UUID-имена)
│   │   └── thumbnails/        # Кэш проксированных превью
│   ├── ffmpeg.exe             # Bundled ffmpeg (+ ffplay.exe, ffprobe.exe)
│   ├── logs/
│   ├── tunegrab.db
│   ├── secret_key.txt         # JWT-секрет (env TUNEGRAB_SECRET_KEY или атомарная автогенерация)
│   └── requirements.txt       # fastapi, uvicorn, sqlalchemy[asyncio], aiosqlite, alembic, yt-dlp, argon2-cffi, PyJWT, mutagen, python-multipart
└── frontend/                  # ✅ реализован (см. ARCHITECTURE_FRONT.md)
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
- **Playlist** — id, user_id (FK CASCADE, автор), name, `share_token` (UUID, nullable; NULL = приватный). Плейлисты — **соавторские**: доступ через `PlaylistAccess`, автор + подписчики могут редактировать содержимое.
- **PlaylistTrack** — составной PK; UNIQUE(playlist_id, track_id), INDEX(playlist_id, position), ON DELETE CASCADE.
- **PlaylistAccess** (миграция 0003) — составной PK (playlist_id, user_id), оба FK CASCADE, INDEX(user_id), created_at. Подписка пользователя на чужой плейлист.
- **ListenEvent** — id, user_id, track_id, event_type (**play / skip / complete**), `fraction_played` (Float 0.0–1.0), created_at; INDEX(user_id, track_id).
- **Like** — составной PK (user_id, track_id), created_at.

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

`GET /youtube/thumbnail/{youtube_id}` — прокси YouTube-превью, требует cookie-аутентификации: whitelist-regex на id, кэш на диске в `downloads/thumbnails/`, `Cache-Control: public, max-age=604800`, 404 при ошибке загрузки. Поиск (`/youtube/search`) переписывает `thumbnail_url` на этот прокси.

## Рекомендации и события

- **`/events` — реализовано**: `POST /events` (запись события; 404 на несуществующий трек; валидация: enum play/skip/complete, fraction 0.0–1.0, complete ⇒ fraction ≥ 0.9), `GET /events/me/stats` (query-параметр `period_days` 1–30, по умолчанию 7), `GET /events/me/history` (пагинация limit 1–100 / offset).
- **`/likes` — реализовано**: `GET /likes` (пагинация, JOIN tracks, ORDER BY created_at DESC), `GET /likes/ids` (все лайкнутые id текущего пользователя одним лёгким запросом — источник состояния сердечек на фронте, работает независимо от пагинации списка «Любимого»), `PUT /likes/{track_id}` (201 новый / 200 идемпотентный повтор), `DELETE /likes/{track_id}` (204, идемпотентен).
- Правила событий: `play` — при первом старте трека; `complete` — при ended, если фактически прослушанная доля ≥ 0.9; `skip` — при ручном переходе или ended ниже порога. **fraction_played считается по фактическому времени прослушивания** (накопление дельт timeupdate с отсечкой скачков перемотки > 2 с), а не по конечной позиции.
- Статистика (`/events/me/stats`): счётчики play/skip/complete, суммарное время (SUM fraction × duration), **топ-3 трека** с listened_seconds (сумма fraction × duration по всем событиям трека, включая skip/complete — треки выбираются по play через `HAVING SUM(play_weight) > 0`). Период задаётся клиентом (`period_days`, 1–30). Ранжирование топа — по **«затухающему» счёту запусков**: каждый play весит `2^(−возраст_дней / 2)` (полураспад 2 дня, `created_at` и `julianday('now')` — в UTC) — недавние прослушивания поднимаются в топе быстрее старых рекордов; `play_count` и `listened_seconds` в ответе — сырые (невзвешенные).
- Лайки: toggle на фронте (profile.store, оптимистичный с откатом); бэк — идемпотентные PUT/DELETE.

## Плейлисты

- **`/playlists` — реализовано**, модель **соавторства**:
  - **Матрица прав**: чтение и редактирование (rename, треки, порядок) — автор **и подписчики**; удаление плейлиста и share-операции — **только автор** (`PlaylistNotOwnedError` → **403**); отписка — только подписчик (автору своя — 403). Посторонний без подписки → 404 (маскировка существования).
  - `GET /playlists` (свои + подписные, каждый с `owner_username` и `is_owner`), `POST /playlists {name ≤200}` → 201;
  - `GET /playlists/{id}` (detail: треки по position ASC, `owner_username`, `is_owner`), `PATCH` (rename), `DELETE` → 204 (каскад: tracks + access);
  - `POST /playlists/{id}/tracks {track_id}` → 201 + detail; дубль → 409; нет трека → 404; позиция = max+1;
  - `DELETE /playlists/{id}/tracks/{track_id}` → 204 + компактизация позиций; нет связи → 404;
  - `PUT /playlists/{id}/tracks/order {track_ids}` → 200; состав не совпал → **409**;
  - `POST /playlists/{id}/share` → `{share_url}` (создание/ротация uuid4-токена; только автор), `DELETE .../share` → 204 (отзыв);
  - `POST /playlists/shared/{token}/subscribe` (auth, идемпотентный) — **автоподписка**: вызывается SharedView при открытии ссылки залогиненным (GET не меняет состояние); автор открывает свою ссылку — no-op;
  - `DELETE /playlists/{id}/access` (auth) — отписка; автору своя → 403; без подписки → 404;
  - **`GET /playlists/shared/{token}`** — публичный (без cookie): `{name, owner_username, tracks}`; треки **без `audio_url`** — анонимный доступ к стримингу не предусмотрен. SPA-страница шаринга — `/shared/:token` (не проксируется Vite; API сознательно живёт внутри `/playlists`; dev-прокси `/playlists` имеет `bypass` на `Accept: text/html`, иначе перезагрузка страницы плейлиста отдаёт JSON FastAPI).
- Дедупликация трека в плейлисте — UNIQUE-констрейнтом + `IntegrityError` → 409.
- Синхронизация между пользователями: одна БД на сервере + `force`-перезагрузка списка/detail при входе на страницу.
- Рекомендации — не реализовано (модели в БД готовы).

## Админ-панель

UI — маршрут `/admin` (см. ARCHITECTURE_FRONT.md), открывается по клику на никнейм в шапке. Все endpoint'ы требуют авторизации (cookie); POST подпадает под Origin-middleware (CSRF).

| Endpoint | Ответ |
|---|---|
| `GET /admin/health` | `{ status, storage_ok, ffmpeg_found, track_count, disk_total_bytes, disk_free_bytes, storage: { audio_bytes, covers_bytes, thumbnails_bytes, total_bytes } }` — размеры считаются по директориям (корень `downloads/` минус `covers/` и `thumbnails/` = аудио), обход файлов и `shutil.disk_usage` (том `downloads/`) — в `asyncio.to_thread` |
| `POST /admin/thumbnails/clear` | `{ deleted_files, freed_bytes }` — удаляет все файлы кэша `downloads/thumbnails/` (превью перекачаются по требованию) |
| `POST /admin/commands/verify-storage` | `{ ok, errors: [...] }` — логика CLI `verify-storage` (директории, файлы треков, ffmpeg) |
| `POST /admin/commands/cleanup-orphans` | `{ deleted_count, files: [...] }` — логика CLI `cleanup-orphans` (без dry-run), пути в ответе — относительно `downloads/` |

- Сервис — `services/admin_service.py`; логика verify/cleanup переиспользуется из `storage.py`, CLI работает как раньше.
- На бэкенде редактирование/загрузка треков через панель не предусмотрены — только просмотр состояния и обслуживание.

## Инфраструктура

- **Dev/Prod**: dev — Vite dev-server (порт 8080) + proxy на FastAPI (порт 8000); production-режим включается env `TUNEGRAB_ENV=production` (влияет на `Secure` cookie и CORS), раздача собранного фронтенда отдельно не реализована. `ALLOWED_ORIGINS` из env.
- **SQLite**: `journal_mode=WAL`, `busy_timeout`, **`foreign_keys=ON`**; миграции — Alembic (0001_initial_schema, 0002_active_downloads_index, 0003_playlist_access), не `create_all`.
- **Health**: публичный `GET /health` → `{status, storage: ok|warn}` (проверка `downloads/` и `covers/`); расширенный `GET /admin/health` — только для авторизованных (раздел «Админ-панель»).
- **Логирование**: файл + консоль; ошибки, ход загрузки, ключевые действия.
- **Ошибки**: централизованные exception handlers — 404 (TrackNotFound/StreamNotFound), 409 (файл занят, дубликат), 416 (Range), 413 (upload), 422 (Pydantic/upload), 429 (rate limit).
- **Списки**: `q` (≤200), `sort_by` (**enum-белый список**), `order` ∈ {asc, desc}, `limit` 1–100 (дефолт 50), `offset` ≥ 0.
- **CLI**: `python -m app.cli cleanup-orphans [--dry-run]`, `verify-storage`.
- **Тесты**: ~68 smoke-тестов (pytest + httpx) — auth lifecycle, Origin-middleware, stream (Range/416/HEAD/traversal), tracks (CRUD, 409), upload (валидация, дубликаты), youtube (search-моки, дедуп, active-список, state machine, ffmpeg), thumbnails, события, лайки, плейлисты (CRUD, reorder, share, изоляция пользователей), миграции. Не покрыты: rate limiting, `/health`.

## Масштабируемость (~10k треков)

- SQLite с индексами справляется без смены стека; API не отдаёт библиотеку целиком — пагинация + поиск.
- Frontend использует бесконечный список (страницы по 50), `loading="lazy"` обложек.
- Стриминг читает диапазон файла — от размера библиотеки не зависит.
