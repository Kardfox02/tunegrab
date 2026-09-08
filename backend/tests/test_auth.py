import pytest


ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}


@pytest.mark.anyio
async def test_auth_lifecycle(client):
    register = await client.post(
        "/auth/register",
        json={"username": "alice", "password": "password123"},
        headers=HEADERS,
    )
    assert register.status_code == 201
    assert "tunegrab_session" in register.cookies

    me = await client.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == "alice"

    wrong_login = await client.post(
        "/auth/login",
        json={"username": "alice", "password": "wrong-password"},
        headers=HEADERS,
    )
    assert wrong_login.status_code == 401

    old_cookie = client.cookies.get("tunegrab_session")
    changed = await client.post(
        "/auth/change-password",
        json={"current_password": "password123", "new_password": "new-password123"},
        headers=HEADERS,
    )
    assert changed.status_code == 200
    assert client.cookies.get("tunegrab_session") != old_cookie

    login_old_password = await client.post(
        "/auth/login",
        json={"username": "alice", "password": "password123"},
        headers=HEADERS,
    )
    assert login_old_password.status_code == 401

    logout = await client.post("/auth/logout", headers=HEADERS)
    assert logout.status_code == 204
    assert (await client.get("/auth/me")).status_code == 401


@pytest.mark.anyio
async def test_origin_is_required_for_state_changes(client):
    response = await client.post(
        "/auth/register",
        json={"username": "alice", "password": "password123"},
    )
    assert response.status_code == 403


@pytest.mark.anyio
async def test_private_network_origin_is_allowed_in_development(client):
    response = await client.post(
        "/auth/register",
        json={"username": "lan-user", "password": "password123"},
        headers={"Origin": "http://192.168.0.12:5173"},
    )
    assert response.status_code == 201


@pytest.mark.anyio
async def test_untrusted_origin_is_rejected(client):
    response = await client.post(
        "/auth/register",
        json={"username": "evil-user", "password": "password123"},
        headers={"Origin": "http://evil.example"},
    )
    assert response.status_code == 403
