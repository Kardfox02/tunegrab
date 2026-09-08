import asyncio
import logging
import os
import subprocess
import uuid
from pathlib import Path

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.download.states import InvalidTrackTransitionError, TrackStatus, transition_status
from app.models.track import Track
from app.services import youtube_service
from app.storage import resolve_download_path

logger = logging.getLogger(__name__)


class DownloadCancelled(Exception):
    pass


class DownloadManager:
    def __init__(self, session_factory=SessionLocal) -> None:
        self.session_factory = session_factory
        self.queue: asyncio.Queue[int] = asyncio.Queue()
        self.worker: asyncio.Task[None] | None = None
        self._stopping = False
        self._cancelled: set[int] = set()
        self._active_processes: dict[int, asyncio.subprocess.Process] = {}
        self._progress_last: dict[int, tuple[float, float]] = {}

    async def start(self) -> None:
        settings.downloads_dir.mkdir(parents=True, exist_ok=True)
        settings.covers_dir.mkdir(parents=True, exist_ok=True)
        await self._recover()
        self._stopping = False
        self.worker = asyncio.create_task(self._run_worker(), name="tunegrab-download-worker")

    async def stop(self) -> None:
        self._stopping = True
        for process in self._active_processes.values():
            if process.returncode is None:
                process.terminate()
        if self.worker:
            self.worker.cancel()
            await asyncio.gather(self.worker, return_exceptions=True)
            self.worker = None

    async def enqueue(self, track_id: int) -> None:
        await self.queue.put(track_id)

    async def cancel(self, track_id: int) -> bool:
        async with self.session_factory() as session:
            track = await session.get(Track, track_id)
            if track is None:
                return False
            if track.status in {TrackStatus.DONE, TrackStatus.ERROR, TrackStatus.CANCELLED}:
                return False
            self._cancelled.add(track_id)
            process = self._active_processes.get(track_id)
            if process and process.returncode is None:
                process.terminate()
            await self._set_status(session, track, TrackStatus.CANCELLED)
            await session.commit()
            return True

    async def retry(self, track_id: int) -> Track | None:
        async with self.session_factory() as session:
            track = await session.get(Track, track_id)
            if track is None:
                return None
            transition_status(track.status, TrackStatus.PENDING)
            track.status = TrackStatus.PENDING
            track.progress = 0
            await session.commit()
            await self.enqueue(track_id)
            return track

    async def _recover(self) -> None:
        async with self.session_factory() as session:
            tracks = (await session.scalars(select(Track))).all()
            for track in tracks:
                if track.status in {TrackStatus.DOWNLOADING, TrackStatus.CONVERTING, TrackStatus.FINALIZING}:
                    track.status = TrackStatus.ERROR
                if track.status == TrackStatus.DONE:
                    try:
                        file_missing = not track.file_path or not resolve_download_path(track.file_path).is_file()
                    except ValueError:
                        file_missing = True
                    if file_missing:
                        track.status = TrackStatus.ERROR
                if track.status == TrackStatus.PENDING:
                    await self.queue.put(track.id)
            await session.commit()
        for path in settings.downloads_dir.rglob("*.part"):
            path.unlink(missing_ok=True)
        for path in settings.downloads_dir.rglob("*.tmp"):
            path.unlink(missing_ok=True)

    async def _run_worker(self) -> None:
        while not self._stopping:
            track_id = await self.queue.get()
            try:
                await self._process(track_id)
            except Exception:
                logger.exception("Download failed for track %s", track_id)
            finally:
                self.queue.task_done()

    async def _process(self, track_id: int) -> None:
        async with self.session_factory() as session:
            track = await session.get(Track, track_id)
            if track is None or track.status != TrackStatus.PENDING:
                return
            await self._set_status(session, track, TrackStatus.DOWNLOADING)
            await session.commit()
            youtube_id = track.youtube_id

        temporary_base = settings.downloads_dir / f".{uuid.uuid4().hex}.part"
        temporary_output = settings.downloads_dir / f".{uuid.uuid4().hex}.mp3.tmp"
        final_path = settings.downloads_dir / f"{uuid.uuid4().hex}.mp3"
        stored_cover_path: Path | None = None
        published = False
        try:
            loop = asyncio.get_running_loop()

            def progress_hook(data: dict) -> None:
                if track_id in self._cancelled:
                    raise DownloadCancelled
                downloaded = data.get("downloaded_bytes") or 0
                total = data.get("total_bytes") or data.get("total_bytes_estimate")
                if total:
                    progress = max(0.0, min(80.0, float(downloaded) / float(total) * 80))
                    loop.call_soon_threadsafe(self._schedule_progress, track_id, progress)

            await youtube_service.download(
                f"https://www.youtube.com/watch?v={youtube_id}",
                str(temporary_base) + ".%(ext)s",
                progress_hook,
            )
            source = self._find_download_source(temporary_base)
            await self._set_track_status(track_id, TrackStatus.CONVERTING, 80)
            await self._run_ffmpeg(track_id, source, temporary_output)
            await self._set_track_status(track_id, TrackStatus.FINALIZING, 95)
            os.replace(temporary_output, final_path)
            cover_path = self._find_cover_source(temporary_base)
            if cover_path:
                stored_cover_path = settings.covers_dir / f"{uuid.uuid4().hex}{cover_path.suffix.lower()}"
                os.replace(cover_path, stored_cover_path)
            async with self.session_factory() as session:
                track = await session.get(Track, track_id)
                if track is None:
                    return
                track.file_path = str(final_path.relative_to(settings.downloads_dir))
                if stored_cover_path:
                    track.cover_path = str(stored_cover_path.relative_to(settings.downloads_dir))
                track.file_size = final_path.stat().st_size
                await self._set_status(session, track, TrackStatus.DONE)
                track.progress = 100
                await session.commit()
            published = True
        except (DownloadCancelled, asyncio.CancelledError):
            await self._mark_terminal(track_id, TrackStatus.CANCELLED)
        except Exception:
            await self._mark_terminal(track_id, TrackStatus.ERROR)
            raise
        finally:
            self._cancelled.discard(track_id)
            self._progress_last.pop(track_id, None)
            for path in settings.downloads_dir.glob(f".{temporary_base.name[1:]}*"):
                path.unlink(missing_ok=True)
            temporary_output.unlink(missing_ok=True)
            if not published:
                final_path.unlink(missing_ok=True)
                if stored_cover_path is not None:
                    stored_cover_path.unlink(missing_ok=True)

    @staticmethod
    def _find_download_source(base: Path) -> Path:
        matches = list(base.parent.glob(base.name + ".*"))
        matches = [path for path in matches if path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}]
        if not matches:
            raise FileNotFoundError("yt-dlp did not produce an audio file")
        return matches[0]

    @staticmethod
    def _find_cover_source(base: Path) -> Path | None:
        for path in base.parent.glob(base.name + ".*"):
            if path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}:
                return path
        return None

    def _schedule_progress(self, track_id: int, progress: float) -> None:
        now = asyncio.get_running_loop().time()
        previous = self._progress_last.get(track_id)
        if previous and now - previous[1] < 1 and progress - previous[0] < 1:
            return
        self._progress_last[track_id] = (progress, now)
        asyncio.create_task(self._set_track_progress(track_id, progress))

    async def _set_track_progress(self, track_id: int, progress: float) -> None:
        async with self.session_factory() as session:
            track = await session.get(Track, track_id)
            if track and track.status == TrackStatus.DOWNLOADING:
                track.progress = progress
                await session.commit()

    async def _run_ffmpeg(self, track_id: int, source: Path, target: Path) -> None:
        process = await asyncio.create_subprocess_exec(
            settings.ffmpeg_path,
            "-y",
            "-i",
            str(source),
            "-vn",
            "-codec:a",
            "libmp3lame",
            "-q:a",
            "0",
            "-f",
            "mp3",
            str(target),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        self._active_processes[track_id] = process
        try:
            _stdout, stderr = await process.communicate()
            if process.returncode != 0:
                detail = (stderr or b"").decode("utf-8", errors="replace")[-2000:]
                logger.error(
                    "ffmpeg failed for track %s (exit code %s): %s",
                    track_id,
                    process.returncode,
                    detail.strip(),
                )
                raise RuntimeError("ffmpeg conversion failed")
        finally:
            self._active_processes.pop(track_id, None)

    async def _set_track_status(self, track_id: int, target: TrackStatus, progress: float) -> None:
        async with self.session_factory() as session:
            track = await session.get(Track, track_id)
            if track is None:
                return
            await self._set_status(session, track, target)
            track.progress = progress
            await session.commit()

    async def _mark_terminal(self, track_id: int, target: TrackStatus) -> None:
        async with self.session_factory() as session:
            track = await session.get(Track, track_id)
            if track is not None and track.status != target:
                try:
                    await self._set_status(session, track, target)
                    await session.commit()
                except InvalidTrackTransitionError:
                    await session.rollback()

    @staticmethod
    async def _set_status(session, track: Track, target: TrackStatus) -> None:
        transition_status(track.status, target)
        track.status = target


download_manager = DownloadManager()
