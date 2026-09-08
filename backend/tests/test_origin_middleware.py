import pytest
from httpx import ASGITransport, AsyncClient
from starlette.responses import PlainTextResponse

from app.middleware.origin import OriginMiddleware


async def endpoint(_scope, _receive, send):
    response = PlainTextResponse("ok")
    await response(_scope, _receive, send)


async def request(origin: str, allow_private_network: bool):
    app = OriginMiddleware(
        endpoint,
        allowed_origins=("http://localhost:5173",),
        allow_private_network=allow_private_network,
    )
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.post("/", headers={"Origin": origin})


@pytest.mark.anyio
async def test_private_origin_is_rejected_when_production_policy_is_enabled():
    response = await request("http://192.168.0.12:5173", allow_private_network=False)
    assert response.status_code == 403


@pytest.mark.anyio
async def test_private_origin_is_allowed_when_development_policy_is_enabled():
    response = await request("http://192.168.0.12:5173", allow_private_network=True)
    assert response.status_code == 200
