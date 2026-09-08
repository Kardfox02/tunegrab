from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, Header, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.dependencies.auth import get_current_user
from app.models.user import User
from app.services.stream_service import StreamFile, stream_service


router = APIRouter(prefix="/stream", tags=["stream"])


def _headers(stream_file: StreamFile, partial: bool) -> dict[str, str]:
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(stream_file.content_length),
        "Content-Type": "audio/mpeg",
        "ETag": stream_file.etag,
        "Last-Modified": stream_file.last_modified,
    }
    if partial:
        headers["Content-Range"] = (
            f"bytes {stream_file.start}-{stream_file.end}/{stream_file.size}"
        )
    return headers


async def _file_chunks(stream_file: StreamFile) -> AsyncIterator[bytes]:
    remaining = stream_file.content_length
    with stream_file.path.open("rb") as audio_file:
        audio_file.seek(stream_file.start)
        while remaining:
            chunk = audio_file.read(min(64 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


async def _get_stream_response(
    track_id: int,
    range_header: str | None,
    session: AsyncSession,
    *,
    head: bool,
) -> Response:
    stream_file = await stream_service.get_file(session, track_id, range_header)
    partial = range_header is not None
    response_headers = _headers(stream_file, partial)
    if head:
        return Response(
            status_code=(
                status.HTTP_206_PARTIAL_CONTENT if partial else status.HTTP_200_OK
            ),
            headers=response_headers,
        )
    return StreamingResponse(
        _file_chunks(stream_file),
        status_code=status.HTTP_206_PARTIAL_CONTENT if partial else status.HTTP_200_OK,
        headers=response_headers,
        media_type="audio/mpeg",
    )


@router.get("/{track_id}", summary="Stream a track with byte range support")
async def stream_track(
    track_id: int,
    range_header: str | None = Header(default=None, alias="Range"),
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    return await _get_stream_response(track_id, range_header, session, head=False)


@router.head("/{track_id}", summary="Return stream metadata")
async def head_track(
    track_id: int,
    range_header: str | None = Header(default=None, alias="Range"),
    _user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    return await _get_stream_response(track_id, range_header, session, head=True)
