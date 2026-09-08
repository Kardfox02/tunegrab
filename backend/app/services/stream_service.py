from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.track import Track
from app.storage import resolve_download_path


class StreamTrackNotFoundError(Exception):
    """The requested track or its audio file does not exist."""


class StreamRangeNotSatisfiableError(Exception):
    """The requested byte range cannot be served by the file."""

    def __init__(self, file_size: int) -> None:
        super().__init__("Range not satisfiable")
        self.file_size = file_size


@dataclass(frozen=True)
class StreamFile:
    path: Path
    size: int
    start: int
    end: int
    etag: str
    last_modified: str

    @property
    def content_length(self) -> int:
        return self.end - self.start + 1


class StreamService:
    async def get_file(
        self,
        session: AsyncSession,
        track_id: int,
        range_header: str | None,
    ) -> StreamFile:
        track = await session.get(Track, track_id)
        if track is None or not track.file_path:
            raise StreamTrackNotFoundError

        try:
            path = resolve_download_path(track.file_path)
        except ValueError as error:
            raise StreamTrackNotFoundError from error

        try:
            file_stat = path.stat()
        except (FileNotFoundError, OSError) as error:
            raise StreamTrackNotFoundError from error
        if not path.is_file():
            raise StreamTrackNotFoundError

        start, end = self._parse_range(range_header, file_stat.st_size)
        return StreamFile(
            path=path,
            size=file_stat.st_size,
            start=start,
            end=end,
            etag=f'"{file_stat.st_size:x}-{file_stat.st_mtime_ns:x}"',
            last_modified=self._http_date(file_stat.st_mtime),
        )

    @staticmethod
    def _parse_range(range_header: str | None, file_size: int) -> tuple[int, int]:
        if file_size <= 0:
            if range_header:
                raise StreamRangeNotSatisfiableError(file_size)
            return 0, -1

        if not range_header:
            return 0, file_size - 1

        if not range_header.startswith("bytes="):
            raise StreamRangeNotSatisfiableError(file_size)

        value = range_header[6:].split(",", 1)[0].strip()
        if "-" not in value:
            raise StreamRangeNotSatisfiableError(file_size)

        first, last = value.split("-", 1)
        try:
            if not first:
                suffix_length = int(last)
                if suffix_length <= 0:
                    raise ValueError
                return max(file_size - suffix_length, 0), file_size - 1

            start = int(first)
            if start < 0 or start >= file_size:
                raise ValueError
            end = file_size - 1 if not last else min(int(last), file_size - 1)
            if end < start:
                raise ValueError
            return start, end
        except (TypeError, ValueError) as error:
            raise StreamRangeNotSatisfiableError(file_size) from error

    @staticmethod
    def _http_date(timestamp: float) -> str:
        from email.utils import formatdate

        return formatdate(timestamp, usegmt=True)


stream_service = StreamService()
