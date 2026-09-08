import os
import secrets
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    backend_dir: Path
    database_url: str
    downloads_dir: Path
    covers_dir: Path
    thumbnails_dir: Path
    logs_dir: Path
    ffmpeg_path: str
    secret_key: str
    production: bool
    allowed_origins: tuple[str, ...]
    auth_cookie_name: str
    auth_ttl_seconds: int
    login_rate_limit: int
    login_rate_window_seconds: int
    password_min_length: int
    youtube_search_rate_limit: int
    youtube_search_rate_window_seconds: int
    youtube_search_max_results: int
    max_upload_bytes: int


def _load_secret(path: Path) -> str:
    value = os.getenv("TUNEGRAB_SECRET_KEY")
    if value:
        return value
    if path.exists():
        return path.read_text(encoding="utf-8").strip()
    value = secrets.token_urlsafe(48)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(value + "\n", encoding="utf-8")
    os.replace(temporary, path)
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return value


def load_settings() -> Settings:
    backend_dir = Path(__file__).resolve().parents[1]
    downloads = backend_dir / "downloads"
    bundled_ffmpeg = backend_dir / "ffmpeg.exe"
    configured_origins = os.getenv(
        "TUNEGRAB_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,"
        "http://127.0.0.1:8080,http://150.241.77.234,http://rknshit.com,http://www.rknshit.com",
    )
    allowed_origins = tuple(
        origin.strip() for origin in configured_origins.split(",") if origin.strip()
    )
    return Settings(
        backend_dir=backend_dir,
        database_url=f"sqlite+aiosqlite:///{backend_dir / 'tunegrab.db'}",
        downloads_dir=downloads,
        covers_dir=downloads / "covers",
        thumbnails_dir=downloads / "thumbnails",
        logs_dir=backend_dir / "logs",
        ffmpeg_path=os.getenv("TUNEGRAB_FFMPEG", str(bundled_ffmpeg if bundled_ffmpeg.is_file() else "ffmpeg")),
        secret_key=_load_secret(backend_dir / "secret_key.txt"),
        production=os.getenv("TUNEGRAB_ENV", "development") == "production",
        allowed_origins=allowed_origins,
        auth_cookie_name="tunegrab_session",
        auth_ttl_seconds=14 * 24 * 60 * 60,
        login_rate_limit=5,
        login_rate_window_seconds=60,
        password_min_length=8,
        youtube_search_rate_limit=20,
        youtube_search_rate_window_seconds=60,
        youtube_search_max_results=10,
        max_upload_bytes=100 * 1024 * 1024,
    )


settings = load_settings()
