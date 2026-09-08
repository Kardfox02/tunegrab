import datetime

import pytest

from app.models.track import Track
from app.models.event import ListenEvent

ORIGIN = "http://localhost:5173"
HEADERS = {"Origin": ORIGIN}


async def register(client, username: str = "alice") -> None:
    response = await client.post(
        "/auth/register",
        json={"username": username, "password": "password123"},
        headers=HEADERS,
    )
    assert response.status_code == 201


async def create_track(db_session, youtube_id: str, title: str, duration: float | None = 180.0) -> Track:
    track = Track(youtube_id=youtube_id, title=title, author="Artist", status="done", duration=duration)
    db_session.add(track)
    await db_session.commit()
    await db_session.refresh(track)
    return track


@pytest.mark.anyio
async def test_events_require_authentication(client):
    assert (
        await client.post("/events", json={"track_id": 1, "event_type": "play", "fraction_played": 0.0}, headers=HEADERS)
    ).status_code == 401
    assert (await client.get("/events/me/stats")).status_code == 401
    assert (await client.get("/events/me/history")).status_code == 401


@pytest.mark.anyio
async def test_record_event_and_read_back(client, db_session):
    await register(client)
    track = await create_track(db_session, "yt-1", "Blue Song", duration=200.0)

    response = await client.post(
        "/events",
        json={"track_id": track.id, "event_type": "play", "fraction_played": 0.0},
        headers=HEADERS,
    )
    assert response.status_code == 201
    body = response.json()
    assert body["track_id"] == track.id
    assert body["event_type"] == "play"
    assert body["fraction_played"] == 0.0

    history = await client.get("/events/me/history")
    assert history.status_code == 200
    history_body = history.json()
    assert history_body["total"] == 1
    assert history_body["items"][0]["event"]["event_type"] == "play"
    assert history_body["items"][0]["track"]["title"] == "Blue Song"

    stats = await client.get("/events/me/stats")
    assert stats.status_code == 200
    stats_body = stats.json()
    assert stats_body["period_days"] == 7
    assert stats_body["play_count"] == 1
    assert stats_body["skip_count"] == 0
    assert stats_body["complete_count"] == 0
    # play с fraction 0.0 не добавляет прослушанное время
    assert stats_body["listened_seconds"] == 0.0
    assert len(stats_body["top_tracks"]) == 1
    assert stats_body["top_tracks"][0]["track"]["id"] == track.id
    assert stats_body["top_tracks"][0]["play_count"] == 1


@pytest.mark.anyio
async def test_record_complete_event_adds_listened_seconds(client, db_session):
    await register(client)
    track = await create_track(db_session, "yt-2", "Long Song", duration=300.0)

    response = await client.post(
        "/events",
        json={"track_id": track.id, "event_type": "complete", "fraction_played": 1.0},
        headers=HEADERS,
    )
    assert response.status_code == 201

    stats = (await client.get("/events/me/stats")).json()
    assert stats["complete_count"] == 1
    assert stats["listened_seconds"] == pytest.approx(300.0)


@pytest.mark.anyio
async def test_record_event_validates_payload(client, db_session):
    await register(client)
    track = await create_track(db_session, "yt-3", "Song")

    # Неизвестный тип события
    response = await client.post(
        "/events",
        json={"track_id": track.id, "event_type": "rewind", "fraction_played": 0.5},
        headers=HEADERS,
    )
    assert response.status_code == 422

    # fraction вне диапазона
    response = await client.post(
        "/events",
        json={"track_id": track.id, "event_type": "play", "fraction_played": 1.5},
        headers=HEADERS,
    )
    assert response.status_code == 422

    # complete требует fraction >= 0.9
    response = await client.post(
        "/events",
        json={"track_id": track.id, "event_type": "complete", "fraction_played": 0.5},
        headers=HEADERS,
    )
    assert response.status_code == 422


@pytest.mark.anyio
async def test_record_event_missing_track_returns_not_found(client):
    await register(client)
    response = await client.post(
        "/events",
        json={"track_id": 999, "event_type": "play", "fraction_played": 0.0},
        headers=HEADERS,
    )
    assert response.status_code == 404


@pytest.mark.anyio
async def test_history_is_scoped_per_user_and_paginated(client, db_session):
    await register(client, "alice")
    track = await create_track(db_session, "yt-4", "Shared Song")

    await client.post(
        "/events",
        json={"track_id": track.id, "event_type": "play", "fraction_played": 0.1},
        headers=HEADERS,
    )

    alice_history = await client.get("/events/me/history")
    assert alice_history.status_code == 200
    assert alice_history.json()["total"] == 1

    # Регистрируем bob (cookie клиента переключается на него) и логинимся:
    # его история пуста — события alice не видны.
    await register(client, "bob")
    bob_login = await client.post("/auth/login", json={"username": "bob", "password": "password123"}, headers=HEADERS)
    assert bob_login.status_code == 200

    empty = await client.get("/events/me/history")
    assert empty.status_code == 200
    assert empty.json()["total"] == 0

    await client.post(
        "/events",
        json={"track_id": track.id, "event_type": "complete", "fraction_played": 1.0},
        headers=HEADERS,
    )

    paged = await client.get("/events/me/history", params={"limit": 1, "offset": 0})
    assert paged.status_code == 200
    body = paged.json()
    assert body["total"] == 1
    assert body["limit"] == 1
    assert body["items"][0]["event"]["event_type"] == "complete"

    stats = (await client.get("/events/me/stats")).json()
    assert stats["play_count"] == 0
    assert stats["complete_count"] == 1


@pytest.mark.anyio
async def test_stats_top_tracks_limited_to_three_with_listened_time(client, db_session):
    await register(client)
    tracks = []
    for index in range(5):
        tracks.append(
            await create_track(db_session, f"yt-top-{index}", f"Track {index}", duration=100.0)
        )

    # Первый трек — 2 play и complete; остальные по одному play.
    for track in tracks:
        await client.post(
            "/events",
            json={"track_id": track.id, "event_type": "play", "fraction_played": 0.0},
            headers=HEADERS,
        )
    await client.post(
        "/events",
        json={"track_id": tracks[0].id, "event_type": "play", "fraction_played": 0.0},
        headers=HEADERS,
    )
    # Время: первый трек дослушан полностью (100 c); второй — skip на середине
    # (50 c); skip не требует fraction >= 0.9, в отличие от complete.
    await client.post(
        "/events",
        json={"track_id": tracks[0].id, "event_type": "complete", "fraction_played": 1.0},
        headers=HEADERS,
    )
    await client.post(
        "/events",
        json={"track_id": tracks[1].id, "event_type": "skip", "fraction_played": 0.5},
        headers=HEADERS,
    )

    stats = (await client.get("/events/me/stats")).json()

    assert len(stats["top_tracks"]) == 3
    first = stats["top_tracks"][0]
    assert first["track"]["id"] == tracks[0].id
    assert first["play_count"] == 2
    assert first["listened_seconds"] == pytest.approx(100.0)
    assert stats["top_tracks"][1]["listened_seconds"] == pytest.approx(50.0)


@pytest.mark.anyio
async def test_stats_top_ranks_recent_plays_higher(client, db_session):
    """Свежий трек с меньшим числом запусков обгоняет старый с большим."""
    await register(client)
    old_track = await create_track(db_session, "yt-old", "Old Hit", duration=100.0)
    new_track = await create_track(db_session, "yt-new", "New Hit", duration=100.0)

    # Старый трек: 3 запуска, все сильно «в прошлом» (6 дней назад).
    for _ in range(3):
        db_session.add(
            ListenEvent(
                user_id=1,
                track_id=old_track.id,
                event_type="play",
                fraction_played=0.0,
                created_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
                - datetime.timedelta(days=6),
            )
        )
    # Свежий трек: 1 запуск сейчас.
    db_session.add(
        ListenEvent(user_id=1, track_id=new_track.id, event_type="play", fraction_played=0.0)
    )
    await db_session.commit()

    stats = (await client.get("/events/me/stats")).json()

    top_ids = [entry["track"]["id"] for entry in stats["top_tracks"]]
    assert top_ids[0] == new_track.id
    assert old_track.id in top_ids


@pytest.mark.anyio
async def test_stats_period_days_filters_window(client, db_session):
    """period_days=1 не учитывает события старше суток; period_days=7 учитывает."""
    await register(client)
    track = await create_track(db_session, "yt-period", "Period Song", duration=100.0)
    db_session.add(
        ListenEvent(
            user_id=1,
            track_id=track.id,
            event_type="play",
            fraction_played=0.0,
            created_at=datetime.datetime.now(datetime.UTC).replace(tzinfo=None)
            - datetime.timedelta(days=2),
        )
    )
    await db_session.commit()

    week = (await client.get("/events/me/stats")).json()
    assert week["period_days"] == 7
    assert week["play_count"] == 1

    day = (await client.get("/events/me/stats", params={"period_days": 1})).json()
    assert day["period_days"] == 1
    assert day["play_count"] == 0
    assert day["top_tracks"] == []


@pytest.mark.anyio
async def test_stats_rejects_invalid_period(client):
    await register(client)
    assert (await client.get("/events/me/stats", params={"period_days": 0})).status_code == 422
    assert (await client.get("/events/me/stats", params={"period_days": 31})).status_code == 422


@pytest.mark.anyio
async def test_history_rejects_invalid_pagination(client):
    await register(client)
    assert (await client.get("/events/me/history", params={"limit": 101})).status_code == 422
    assert (await client.get("/events/me/history", params={"offset": -1})).status_code == 422
