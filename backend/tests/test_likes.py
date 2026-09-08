import pytest

from app.models.track import Track

ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}


async def register(client, username: str = "alice") -> None:
    response = await client.post(
        "/auth/register",
        json={"username": username, "password": "password123"},
        headers=HEADERS,
    )
    assert response.status_code == 201


def make_track(youtube_id: str, title: str) -> Track:
    return Track(youtube_id=youtube_id, title=title, author="Artist", status="done", duration=180.0)


@pytest.mark.anyio
async def test_likes_require_authentication(client):
    assert (await client.get("/likes")).status_code == 401
    assert (await client.get("/likes/ids")).status_code == 401
    assert (await client.put("/likes/1", headers=HEADERS)).status_code == 401
    assert (await client.delete("/likes/1", headers=HEADERS)).status_code == 401


@pytest.mark.anyio
async def test_like_cycle(client, db_session):
    await register(client)
    db_session.add_all([make_track("yt-1", "First"), make_track("yt-2", "Second")])
    await db_session.commit()

    first = (await db_session.scalars(__import__("sqlalchemy").select(Track).where(Track.youtube_id == "yt-1"))).one()
    second = (await db_session.scalars(__import__("sqlalchemy").select(Track).where(Track.youtube_id == "yt-2"))).one()

    put = await client.put(f"/likes/{first.id}", headers=HEADERS)
    assert put.status_code == 201
    assert put.json()["track"]["id"] == first.id

    listing = await client.get("/likes")
    assert listing.status_code == 200
    body = listing.json()
    assert body["total"] == 1
    assert body["items"][0]["track"]["id"] == first.id
    assert "created_at" in body["items"][0]

    delete = await client.delete(f"/likes/{first.id}", headers=HEADERS)
    assert delete.status_code == 204

    empty = await client.get("/likes")
    assert empty.status_code == 200
    assert empty.json()["total"] == 0
    assert empty.json()["items"] == []


@pytest.mark.anyio
async def test_add_like_is_idempotent(client, db_session):
    await register(client)
    db_session.add(make_track("yt-3", "Song"))
    await db_session.commit()
    track = (await db_session.scalars(__import__("sqlalchemy").select(Track).where(Track.youtube_id == "yt-3"))).one()

    first = await client.put(f"/likes/{track.id}", headers=HEADERS)
    second = await client.put(f"/likes/{track.id}", headers=HEADERS)

    assert first.status_code == 201
    assert second.status_code == 200

    listing = (await client.get("/likes")).json()
    assert listing["total"] == 1


@pytest.mark.anyio
async def test_remove_like_is_idempotent(client, db_session):
    await register(client)
    db_session.add(make_track("yt-4", "Song"))
    await db_session.commit()
    track = (await db_session.scalars(__import__("sqlalchemy").select(Track).where(Track.youtube_id == "yt-4"))).one()

    first = await client.delete(f"/likes/{track.id}", headers=HEADERS)
    second = await client.delete(f"/likes/{track.id}", headers=HEADERS)

    assert first.status_code == 204
    assert second.status_code == 204


@pytest.mark.anyio
async def test_like_missing_track_returns_not_found(client):
    await register(client)
    response = await client.put("/likes/999", headers=HEADERS)
    assert response.status_code == 404


@pytest.mark.anyio
async def test_likes_are_scoped_per_user_and_sorted_newest_first(client, db_session):
    await register(client, "alice")
    db_session.add_all([make_track("yt-5", "Old"), make_track("yt-6", "New")])
    await db_session.commit()
    old = (await db_session.scalars(__import__("sqlalchemy").select(Track).where(Track.youtube_id == "yt-5"))).one()
    new = (await db_session.scalars(__import__("sqlalchemy").select(Track).where(Track.youtube_id == "yt-6"))).one()

    await client.put(f"/likes/{old.id}", headers=HEADERS)
    await client.put(f"/likes/{new.id}", headers=HEADERS)

    listing = await client.get("/likes")
    items = listing.json()["items"]
    assert [item["track"]["id"] for item in items] == [new.id, old.id]

    # bob не видит лайки alice
    await register(client, "bob")
    bob_login = await client.post("/auth/login", json={"username": "bob", "password": "password123"}, headers=HEADERS)
    assert bob_login.status_code == 200

    bob_listing = await client.get("/likes")
    assert bob_listing.status_code == 200
    assert bob_listing.json()["total"] == 0


@pytest.mark.anyio
async def test_liked_track_ids_returns_all_ids_scoped_per_user(client, db_session):
    await register(client, "alice")
    db_session.add_all([make_track("yt-7", "A"), make_track("yt-8", "B"), make_track("yt-9", "C")])
    await db_session.commit()
    ids = [
        (
            await db_session.scalars(
                __import__("sqlalchemy").select(Track).where(Track.youtube_id == youtube_id)
            )
        ).one().id
        for youtube_id in ("yt-7", "yt-8", "yt-9")
    ]

    empty = await client.get("/likes/ids")
    assert empty.status_code == 200
    assert empty.json() == {"track_ids": []}

    await client.put(f"/likes/{ids[2]}", headers=HEADERS)
    await client.put(f"/likes/{ids[0]}", headers=HEADERS)

    response = await client.get("/likes/ids")
    assert response.status_code == 200
    assert response.json()["track_ids"] == sorted([ids[0], ids[2]])

    # bob не видит лайки alice
    await register(client, "bob")
    bob_login = await client.post("/auth/login", json={"username": "bob", "password": "password123"}, headers=HEADERS)
    assert bob_login.status_code == 200
    bob_response = await client.get("/likes/ids")
    assert bob_response.status_code == 200
    assert bob_response.json()["track_ids"] == []
