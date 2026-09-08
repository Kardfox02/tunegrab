# Tunegrab

Tunegrab — самохостящийся музыкальный сервис: серверная часть загружает аудио из YouTube, а веб-плеер позволяет слушать музыку, собирать плейлисты и получать рекомендации.

## Возможности

- Загрузка треков из YouTube (через yt-dlp) с автоматической конвертацией в MP3 (FFmpeg)
- Загрузка локальных файлов (MP3) с извлечением метаданных и обложек
- Веб-плеер с очередью, плейлистами и лайками
- Система рекомендаций на основе истории прослушиваний
- Аутентификация пользователей (JWT в cookie,argon2-хеширование паролей)
- Rate limiting для входа и поиска по YouTube
- Живые обновления через SSE (`/events`)

## Стек

| Слой    | Технологии                                                                 |
|---------|----------------------------------------------------------------------------|
| Backend | Python 3.11+, FastAPI, SQLAlchemy 2 (async), aiosqlite, Alembic, yt-dlp, uvicorn |
| Frontend| Vue 3, TypeScript, Vite, Pinia, Vue Router, Vitest                         |
| БД      | SQLite (`backend/tunegrab.db`)                                             |

## Требования

- **Python 3.11+**
- **Node.js 18+** (для фронтенда)
- **FFmpeg** — на Windows положить `ffmpeg.exe` / `ffprobe.exe` в `backend/` (подхватятся автоматически); на Linux — установить в систему (`apt install ffmpeg`) или указать путь через переменную `TUNEGRAB_FFMPEG`
- Доступ к YouTube (yt-dlp скачивает аудио напрямую)

## Запуск

### 1. Backend (порт 8000)

```bash
cd backend
pip install -r requirements.txt

# миграции БД
alembic upgrade head

# запуск (строго один worker — очереди и rate-limiter живут в памяти процесса)
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

### 2. Frontend (порт 8080)

```bash
cd frontend
npm install
npm run dev
```

Vite запустится на `http://localhost:8080` и проксирует API-запросы (`/auth`, `/tracks`, `/youtube`, `/stream`, ...) на `http://localhost:8000`.

### 3. Открыть плеер

Перейти на `http://localhost:8080`, зарегистрироваться и пользоваться.

## Переменные окружения

| Переменная                | По умолчанию | Описание                                          |
|---------------------------|--------------|---------------------------------------------------|
| `TUNEGRAB_SECRET_KEY`     | генерируется | Ключ для подписи JWT (иначе — `backend/secret_key.txt`) |
| `TUNEGRAB_FFMPEG`         | `backend/ffmpeg.exe` или `ffmpeg` из PATH | Путь к FFmpeg |
| `TUNEGRAB_ENV`            | `development`| `production` — включает production-режим          |
| `TUNEGRAB_ALLOWED_ORIGINS`| localhost + домен проекта | Список разрешённых CORS-источников через запятую |

## Структура проекта

```
tunegrab/
├── backend/
│   ├── app/
│   │   ├── api/            # HTTP-эндпоинты (auth, tracks, youtube, stream, likes, events)
│   │   ├── download/       # Менеджер загрузок и очереди
│   │   ├── models/         # ORM-модели SQLAlchemy
│   │   ├── schemas/        # Pydantic-схемы
│   │   ├── services/       # Бизнес-логика (track, thumbnail, upload, ...)
│   │   ├── middleware/     # Origin-check и пр.
│   │   ├── config.py       # Настройки
│   │   ├── database.py     # Подключение к БД
│   │   └── main.py         # Точка входа FastAPI
│   ├── alembic/            # Миграции БД
│   ├── tests/              # Pytest-тесты
│   └── downloads/          # Треки, обложки, превью (в git не попадают)
├── frontend/
│   ├── src/                # Vue-приложение (components, stores, views, ...)
│   └── public/             # Статика
└── ARCHITECTURE.md / ARCHITECTURE_FRONT.md  # Подробное описание архитектуры
```

## Тесты

```bash
# backend
cd backend && pytest

# frontend
cd frontend && npm run test
```

## Безопасность

- `backend/secret_key.txt` и любые скрипты с паролями (например, SSH-туннели) **не коммитятся** — они в `.gitignore`
- Пароли хранятся в виде argon2-хешей
- Загрузка файлов ограничена 100 МБ

## Лицензия

MIT
