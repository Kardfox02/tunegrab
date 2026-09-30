import ipaddress
from collections.abc import Iterable
from urllib.parse import urlsplit

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class OriginMiddleware(BaseHTTPMiddleware):
    def __init__(
        self,
        app,
        allowed_origins: Iterable[str],
        allow_private_network: bool = False,
    ) -> None:
        super().__init__(app)
        self.allowed_origins = frozenset(allowed_origins)
        self.allow_private_network = allow_private_network

    def _is_allowed_origin(self, origin: str | None) -> bool:
        if origin in self.allowed_origins:
            return True
        if not self.allow_private_network or not origin:
            return False

        parsed = urlsplit(origin)
        if parsed.scheme != "http" or parsed.username or parsed.password or parsed.path not in ("", "/"):
            return False

        try:
            address = ipaddress.ip_address(parsed.hostname or "")
        except ValueError:
            return False

        return address.version == 4 and address.is_private

    def _is_same_origin(self, origin: str, request: Request) -> bool:
        """Same-origin POST (браузер шлёт Origin даже без CORS) разрешён:
        фронт отдаётся самим бэкендом, и Origin совпадает со схемой+Host.
        """
        parsed = urlsplit(origin)
        if parsed.path not in ("", "/") or parsed.username or parsed.password:
            return False
        forwarded_proto = request.headers.get("x-forwarded-proto")
        scheme = forwarded_proto.split(",")[0].strip() if forwarded_proto else request.url.scheme
        host = request.headers.get("host")
        if not host:
            return False
        return parsed.scheme == scheme and (parsed.netloc or "").lower() == host.lower()

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if not self._is_allowed_origin(origin) and not (
                origin is not None and self._is_same_origin(origin, request)
            ):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Origin is not allowed"},
                )
        return await call_next(request)
