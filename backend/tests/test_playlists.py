import pytest
from sqlalchemy import select

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


async def login(client, username: str = "alice") -> None:
    response = await client.post(
        "/auth/login",
        json={"username": username, "password": "password123"},
        headers=HEADERS,
    )
    assert response.status_code == 200

def make_track(youtube_id: str, title: str) -> Track:
    return Track(youtube_id=youtube_id, title=title, author="Artist", status="done", duration=180.0)


async def add_tracks(db_session, *youtube_ids: str) -> list[Track]:
    db_session.add_all(make_track(youtube_id, f"Track {youtube_id}") for youtube_id in youtube_ids)
    await db_session.commit()
    rows = []
    for youtube_id in youtube_ids:
        track = (
            await db_session.scalars(select(Track).where(Track.youtube_id == youtube_id))
        ).one()
        rows.append(track)
    return rows


async def create_playlist(client, name: str = "My playlist") -> dict:
    response = await client.post("/playlists", json={"name": name}, headers=HEADERS)
    assert response.status_code == 201
    return response.json()


@pytest.mark.anyio
async def test_playlists_require_authentication(client):
    assert (await client.get("/playlists")).status_code == 401
    assert (await client.post("/playlists", json={"name": "x"}, headers=HEADERS)).status_code == 401
    assert (await client.get("/playlists/1")).status_code == 401
    assert (await client.patch("/playlists/1", json={"name": "x"}, headers=HEADERS)).status_code == 401
    assert (await client.delete("/playlists/1", headers=HEADERS)).status_code == 401


@pytest.mark.anyio
async def test_playlist_crud_cycle(client):
    await register(client)

    created = await create_playlist(client, "Chill")
    assert created["name"] == "Chill"
    assert created["track_count"] == 0
    assert created["share_url"] is None

    listing = (await client.get("/playlists")).json()
    assert listing["total"] == 1
    assert listing["items"][0]["id"] == created["id"]

    renamed = await client.patch(
        f"/playlists/{created['id']}", json={"name": "Focus"}, headers=HEADERS
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Focus"

    detail = await client.get(f"/playlists/{created['id']}")
    assert detail.status_code == 200
    assert detail.json()["name"] == "Focus"
    assert detail.json()["items"] == []

    deleted = await client.delete(f"/playlists/{created['id']}", headers=HEADERS)
    assert deleted.status_code == 204

    listing = (await client.get("/playlists")).json()
    assert listing["total"] == 0

    missing = await client.get(f"/playlists/{created['id']}")
    assert missing.status_code == 404


@pytest.mark.anyio
async def test_create_playlist_validates_name(client):
    await register(client)

    empty = await client.post("/playlists", json={"name": ""}, headers=HEADERS)
    assert empty.status_code == 422

    too_long = await client.post("/playlists", json={"name": "x" * 201}, headers=HEADERS)
    assert too_long.status_code == 422


@pytest.mark.anyio
async def test_add_and_remove_tracks_with_positions(client, db_session):
    await register(client)
    first, second, _third = await add_tracks(db_session, "yt-1", "yt-2", "yt-3")
    playlist = await create_playlist(client)

    added = await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_id": second.id}, headers=HEADERS
    )
    assert added.status_code == 201
    assert [t["id"] for t in added.json()["items"]] == [second.id]

    await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_id": first.id}, headers=HEADERS
    )
    duplicate = await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_id": second.id}, headers=HEADERS
    )
    assert duplicate.status_code == 409

    detail = (await client.get(f"/playlists/{playlist['id']}")).json()
    assert [t["id"] for t in detail["items"]] == [second.id, first.id]

    removed = await client.delete(
        f"/playlists/{playlist['id']}/tracks/{second.id}", headers=HEADERS
    )
    assert removed.status_code == 204

    detail = (await client.get(f"/playlists/{playlist['id']}")).json()
    assert [t["id"] for t in detail["items"]] == [first.id]

    # повторное удаление того же трека — 404 (его больше нет в плейлисте)
    again = await client.delete(
        f"/playlists/{playlist['id']}/tracks/{second.id}", headers=HEADERS
    )
    assert again.status_code == 404


@pytest.mark.anyio
async def test_add_missing_track_returns_not_found(client, db_session):
    await register(client)
    playlist = await create_playlist(client)

    response = await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_id": 999}, headers=HEADERS
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_reorder_tracks(client, db_session):
    await register(client)
    first, second, third = await add_tracks(db_session, "yt-1", "yt-2", "yt-3")
    playlist = await create_playlist(client)

    for track in (first, second, third):
        response = await client.post(
            f"/playlists/{playlist['id']}/tracks", json={"track_id": track.id}, headers=HEADERS
        )
        assert response.status_code == 201

    reordered = await client.put(
        f"/playlists/{playlist['id']}/tracks/order",
        json={"track_ids": [third.id, first.id, second.id]},
        headers=HEADERS,
    )
    assert reordered.status_code == 200
    assert [t["id"] for t in reordered.json()["items"]] == [third.id, first.id, second.id]

    # неполный список — 409
    mismatch = await client.put(
        f"/playlists/{playlist['id']}/tracks/order",
        json={"track_ids": [first.id]},
        headers=HEADERS,
    )
    assert mismatch.status_code == 409


@pytest.mark.anyio
async def test_playlists_are_scoped_per_user(client, db_session):
    await register(client, "alice")
    playlist = await create_playlist(client, "Alice only")

    await register(client, "bob")
    # cookie заменилась на bob'а после register; login не используем,
    # чтобы не упираться в rate limit login'а между тестами

    listing = (await client.get("/playlists")).json()
    assert listing["total"] == 0

    foreign = await client.get(f"/playlists/{playlist['id']}")
    assert foreign.status_code == 404

    foreign_patch = await client.patch(
        f"/playlists/{playlist['id']}", json={"name": "Hacked"}, headers=HEADERS
    )
    assert foreign_patch.status_code == 404

    foreign_delete = await client.delete(f"/playlists/{playlist['id']}", headers=HEADERS)
    # delete/share требуют авторства — посторонний получает 403
    assert foreign_delete.status_code == 403
@pytest.mark.anyio
async def test_share_lifecycle(client, db_session):
    await register(client)
    (track,) = await add_tracks(db_session, "yt-1")
    playlist = await create_playlist(client, "Shared mix")
    await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_id": track.id}, headers=HEADERS
    )

    # аноним без токена не имеет доступа
    assert (await client.get(f"/playlists/{playlist['id']}/shared/nope")).status_code == 404

    shared = await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    assert shared.status_code == 200
    share_url = shared.json()["share_url"]
    assert share_url is not None and share_url.startswith("/shared/")
    token = share_url.rsplit("/", 1)[1]

    # публичный доступ без cookie
    public = await client.get(f"/playlists/shared/{token}")
    assert public.status_code == 200
    body = public.json()
    assert body["name"] == "Shared mix"
    assert body["owner_username"] == "alice"
    assert len(body["tracks"]) == 1
    assert body["tracks"][0]["id"] == track.id
    # публичный ответ не содержит ссылку на стриминг
    assert body["tracks"][0]["audio_url"] is None

    # ротация токена: старая ссылка умирает
    rotated = await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    new_token = rotated.json()["share_url"].rsplit("/", 1)[1]
    assert new_token != token
    assert (await client.get(f"/playlists/shared/{token}")).status_code == 404
    assert (await client.get(f"/playlists/shared/{new_token}")).status_code == 200

    # отзыв ссылки
    revoked = await client.delete(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    assert revoked.status_code == 204
    assert (await client.get(f"/playlists/shared/{new_token}")).status_code == 404

    detail = (await client.get(f"/playlists/{playlist['id']}")).json()
    assert detail["share_url"] is None


@pytest.mark.anyio
async def test_share_requires_owner(client, db_session):
    await register(client, "alice")
    playlist = await create_playlist(client, "Alice private")

    await register(client, "bob")
    # сессия теперь bob'а — его вызов share на чужой плейлист даёт 403
    # (плейлист существует, но share — только для владельца)
    response = await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    assert response.status_code == 403


@pytest.mark.anyio
async def test_created_playlist_has_owner_fields(client):
    await register(client, "alice")
    created = await create_playlist(client, "Mine")

    assert created["owner_username"] == "alice"
    assert created["is_owner"] is True

    detail = (await client.get(f"/playlists/{created['id']}")).json()
    assert detail["owner_username"] == "alice"
    assert detail["is_owner"] is True


@pytest.mark.anyio
async def test_share_open_by_subscriber_creates_access_and_syncs(client, db_session):
    await register(client, "alice")
    (track,) = await add_tracks(db_session, "yt-1")
    playlist = await create_playlist(client, "Co-op mix")
    await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_id": track.id}, headers=HEADERS
    )
    shared = await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    token = shared.json()["share_url"].rsplit("/", 1)[1]

    # bob открывает ссылку → автоподписка
    await register(client, "bob")
    subscribed = await client.post(f"/playlists/shared/{token}/subscribe", headers=HEADERS)
    assert subscribed.status_code == 200
    assert subscribed.json() == {"playlist_id": playlist["id"]}

    # плейлист появился в списке bob'а с именем автора и is_owner=false
    bob_listing = (await client.get("/playlists")).json()
    assert bob_listing["total"] == 1
    tile = bob_listing["items"][0]
    assert tile["id"] == playlist["id"]
    assert tile["owner_username"] == "alice"
    assert tile["is_owner"] is False

    # bob видит detail с треками
    detail = await client.get(f"/playlists/{playlist['id']}")
    assert detail.status_code == 200
    assert [t["id"] for t in detail.json()["items"]] == [track.id]
    assert detail.json()["is_owner"] is False

    # повторная автоподписка идемпотентна (дублей в списке нет)
    again = await client.post(f"/playlists/shared/{token}/subscribe", headers=HEADERS)
    assert again.status_code == 200
    assert (await client.get("/playlists")).json()["total"] == 1

    # третий пользователь тоже может подписаться по той же ссылке
    await register(client, "carol")
    await client.post(f"/playlists/shared/{token}/subscribe", headers=HEADERS)
    carol_listing = (await client.get("/playlists")).json()
    assert carol_listing["total"] == 1
    assert carol_listing["items"][0]["owner_username"] == "alice"


@pytest.mark.anyio
async def test_coauthor_can_edit_but_not_delete_or_share(client, db_session):
    await register(client, "alice")
    first, second = await add_tracks(db_session, "yt-1", "yt-2")
    playlist = await create_playlist(client, "Co-edited")
    await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_id": first.id}, headers=HEADERS
    )
    shared = await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    token = shared.json()["share_url"].rsplit("/", 1)[1]

    await register(client, "bob")
    await client.post(f"/playlists/shared/{token}/subscribe", headers=HEADERS)

    # соавтор добавляет трек
    added = await client.post(
        f"/playlists/{playlist['id']}/tracks", json={"track_id": second.id}, headers=HEADERS
    )
    assert added.status_code == 201
    assert [t["id"] for t in added.json()["items"]] == [first.id, second.id]

    # соавтор переименовывает
    renamed = await client.patch(
        f"/playlists/{playlist['id']}", json={"name": "Renamed by bob"}, headers=HEADERS
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Renamed by bob"

    # соавтор меняет порядок
    reordered = await client.put(
        f"/playlists/{playlist['id']}/tracks/order",
        json={"track_ids": [second.id, first.id]},
        headers=HEADERS,
    )
    assert reordered.status_code == 200
    assert [t["id"] for t in reordered.json()["items"]] == [second.id, first.id]

    # соавтор удаляет трек
    removed = await client.delete(
        f"/playlists/{playlist['id']}/tracks/{second.id}", headers=HEADERS
    )
    assert removed.status_code == 204

    # соавтор НЕ может удалить плейлист и управлять share — 403
    assert (await client.delete(f"/playlists/{playlist['id']}", headers=HEADERS)).status_code == 403
    assert (await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)).status_code == 403
    assert (await client.delete(f"/playlists/{playlist['id']}/share", headers=HEADERS)).status_code == 403


@pytest.mark.anyio
async def test_unsubscribe_and_owner_cannot_unsubscribe_own(client, db_session):
    await register(client, "alice")
    playlist = await create_playlist(client, "For bob")
    shared = await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    token = shared.json()["share_url"].rsplit("/", 1)[1]

    await register(client, "bob")
    await client.post(f"/playlists/shared/{token}/subscribe", headers=HEADERS)
    assert (await client.get("/playlists")).json()["total"] == 1

    # отписка
    unsubscribed = await client.delete(f"/playlists/{playlist['id']}/access", headers=HEADERS)
    assert unsubscribed.status_code == 204
    assert (await client.get("/playlists")).json()["total"] == 0
    assert (await client.get(f"/playlists/{playlist['id']}")).status_code == 404

    # повторная отписка — 404 (подписки больше нет)
    again = await client.delete(f"/playlists/{playlist['id']}/access", headers=HEADERS)
    assert again.status_code == 404


@pytest.mark.anyio
async def test_owner_cannot_unsubscribe_own_playlist(client):
    await register(client, "alice")
    playlist = await create_playlist(client, "My own")

    response = await client.delete(f"/playlists/{playlist['id']}/access", headers=HEADERS)
    assert response.status_code == 403


@pytest.mark.anyio
async def test_owner_opening_own_share_link_does_not_duplicate(client, db_session):
    await register(client, "alice")
    playlist = await create_playlist(client, "Self link")
    shared = await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    token = shared.json()["share_url"].rsplit("/", 1)[1]

    subscribed = await client.post(f"/playlists/shared/{token}/subscribe", headers=HEADERS)
    assert subscribed.status_code == 200

    listing = (await client.get("/playlists")).json()
    assert listing["total"] == 1
    assert listing["items"][0]["is_owner"] is True


@pytest.mark.anyio
async def test_deleting_playlist_cascades_access(client, db_session):
    await register(client, "alice")
    playlist = await create_playlist(client, "Doomed")
    shared = await client.post(f"/playlists/{playlist['id']}/share", headers=HEADERS)
    token = shared.json()["share_url"].rsplit("/", 1)[1]
    # сохраняем cookie alice, чтобы вернуться без login (rate limit login'а)
    alice_cookies = dict(client.cookies)

    await register(client, "bob")
    await client.post(f"/playlists/shared/{token}/subscribe", headers=HEADERS)
    assert (await client.get("/playlists")).json()["total"] == 1
    bob_cookies = dict(client.cookies)

    # alice удаляет плейлист — таблица access не держит сирот (CASCADE)
    client.cookies = alice_cookies
    deleted = await client.delete(f"/playlists/{playlist['id']}", headers=HEADERS)
    assert deleted.status_code == 204

    # у bob'а плейлист исчез из списка, detail недоступен, токен мёртв
    client.cookies = bob_cookies
    assert (await client.get("/playlists")).json()["total"] == 0
    assert (await client.get(f"/playlists/{playlist['id']}")).status_code == 404
    assert (await client.post(f"/playlists/shared/{token}/subscribe", headers=HEADERS)).status_code == 404
