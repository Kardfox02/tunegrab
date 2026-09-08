import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { addLike, fetchLikedTrackIds, fetchLikes, removeLike } from '@/api/likes-api'
import { fetchListeningStats } from '@/api/events-api'
import { useAuthStore } from '@/stores/auth.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { useProfileStore } from '@/stores/profile.store'
import type { Track } from '@/types/track'
import type { ListeningStats } from '@/types/events'

vi.mock('@/api/events-api', () => ({
  fetchListeningStats: vi.fn(),
}))

vi.mock('@/api/likes-api', () => ({
  fetchLikes: vi.fn(),
  fetchLikedTrackIds: vi.fn(),
  addLike: vi.fn(),
  removeLike: vi.fn(),
}))

const mockedFetchLikes = vi.mocked(fetchLikes)
const mockedFetchLikedTrackIds = vi.mocked(fetchLikedTrackIds)
const mockedAdd = vi.mocked(addLike)
const mockedRemove = vi.mocked(removeLike)
const mockedStats = vi.mocked(fetchListeningStats)

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    youtube_id: 'video-1',
    title: 'Song',
    author: 'Artist',
    duration: 200,
    status: 'done',
    progress: 100,
    file_size: 1024,
    created_at: '2026-09-01T00:00:00Z',
    audio_url: '/stream/1',
    cover_url: null,
    ...overrides,
  }
}

function statsFixture(overrides: Partial<ListeningStats> = {}): ListeningStats {
  return {
    period_days: 7,
    play_count: 3,
    skip_count: 1,
    complete_count: 2,
    listened_seconds: 5400,
    top_tracks: [],
    ...overrides,
  }
}

describe('profile store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mockedStats.mockResolvedValue(statsFixture())
    mockedFetchLikedTrackIds.mockResolvedValue([1, 2])
    mockedFetchLikes.mockResolvedValue({
      items: [
        { track: createTrack({ id: 1 }), created_at: '2026-09-01T00:00:00Z' },
        { track: createTrack({ id: 2, title: 'Second' }), created_at: '2026-09-02T00:00:00Z' },
      ],
      total: 2,
      limit: 50,
      offset: 0,
    })
  })

  it('loads stats and likes once per session', async () => {
    const profile = useProfileStore()

    await profile.loadProfile()
    await profile.loadProfile()

    expect(mockedStats).toHaveBeenCalledTimes(1)
    expect(mockedFetchLikes).toHaveBeenCalledTimes(1)
    expect(profile.isLoaded).toBe(true)
    expect([...profile.likedTrackIds]).toEqual([1, 2])
    expect(profile.stats?.play_count).toBe(3)
  })

  it('marks hearts for tracks beyond the first likes page right after load', async () => {
    // 60 лайков: ids приходят все из /likes/ids, а список — только первая партия.
    mockedFetchLikedTrackIds.mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, index) => index + 1),
    )
    mockedFetchLikes.mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, index) => ({
        track: createTrack({ id: index + 1 }),
        created_at: '2026-09-01T00:00:00Z',
      })),
      total: 60,
      limit: 50,
      offset: 0,
    })
    const profile = useProfileStore()
    await profile.loadProfile()

    expect(profile.likedTrackIds.size).toBe(60)
    expect(profile.likedTrackIds.has(51)).toBe(true)
    expect(profile.likedTrackIds.has(60)).toBe(true)
    // Список «Любимое» пока содержит только первую партию.
    expect(profile.likedTracks).toHaveLength(50)
  })

  it('keeps heart ids untouched when the next likes page loads', async () => {
    mockedFetchLikedTrackIds.mockResolvedValueOnce(
      Array.from({ length: 60 }, (_, index) => index + 1),
    )
    mockedFetchLikes.mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, index) => ({
        track: createTrack({ id: index + 1 }),
        created_at: '2026-09-01T00:00:00Z',
      })),
      total: 60,
      limit: 50,
      offset: 0,
    })
    const profile = useProfileStore()
    await profile.loadProfile()

    mockedFetchLikes.mockResolvedValueOnce({
      items: Array.from({ length: 10 }, (_, index) => ({
        track: createTrack({ id: 51 + index }),
        created_at: '2026-09-02T00:00:00Z',
      })),
      total: 60,
      limit: 50,
      offset: 50,
    })
    await profile.loadNextLikes()

    expect(profile.likedTracks).toHaveLength(60)
    expect(profile.likedTrackIds.size).toBe(60)
  })

  it('forces reload when requested', async () => {
    const profile = useProfileStore()

    await profile.loadProfile()
    await profile.loadProfile(true)

    expect(mockedStats).toHaveBeenCalledTimes(2)
  })

  it('reloads stats and likes from scratch on every visit', async () => {
    const profile = useProfileStore()

    await profile.loadProfile()
    expect(profile.stats?.play_count).toBe(3)
    expect(profile.likedTrackIds.has(1)).toBe(true)

    mockedStats.mockResolvedValueOnce(statsFixture({ play_count: 42 }))
    mockedFetchLikedTrackIds.mockResolvedValueOnce([9])
    mockedFetchLikes.mockResolvedValueOnce({
      items: [{ track: createTrack({ id: 9, title: 'Fresh' }), created_at: '2026-09-03T00:00:00Z' }],
      total: 1,
      limit: 50,
      offset: 0,
    })

    await profile.reloadProfile()

    expect(mockedStats).toHaveBeenCalledTimes(2)
    expect(mockedFetchLikes).toHaveBeenCalledTimes(2)
    expect(mockedFetchLikedTrackIds).toHaveBeenCalledTimes(2)
    expect(profile.stats?.play_count).toBe(42)
    expect(profile.likedTrackIds.has(9)).toBe(true)
    expect(profile.likedTrackIds.has(1)).toBe(false)
    expect(profile.isLoaded).toBe(true)
    // Состояние загрузки завершено — спиннеры скрыты.
    expect(profile.isStatsLoading).toBe(false)
    expect(profile.isLoadingLikes).toBe(false)
  })

  it('records load errors without throwing', async () => {
    mockedStats.mockRejectedValueOnce(new Error('fail'))
    mockedFetchLikes.mockRejectedValueOnce(new Error('fail'))
    const profile = useProfileStore()

    await expect(profile.loadProfile()).resolves.toBeUndefined()

    expect(profile.statsError).toBe('Не удалось загрузить статистику')
    expect(profile.likesError).toBe('Не удалось загрузить любимые треки')
    expect(profile.isLoaded).toBe(true)
  })

  it('toggles like optimistically: add then remove', async () => {
    const profile = useProfileStore()
    await profile.loadProfile()

    const fresh = createTrack({ id: 3, title: 'Third' })
    await profile.toggleLike(fresh)

    expect(profile.likedTrackIds.has(3)).toBe(true)
    expect(profile.likedTracks[0]?.id).toBe(3)
    expect(mockedAdd).toHaveBeenCalledWith(3)

    await profile.toggleLike(fresh)

    expect(profile.likedTrackIds.has(3)).toBe(false)
    expect(mockedRemove).toHaveBeenCalledWith(3)
  })

  it('rolls back the optimistic add when the API fails', async () => {
    mockedAdd.mockRejectedValueOnce(new Error('fail'))
    const profile = useProfileStore()
    await profile.loadProfile()

    const fresh = createTrack({ id: 3, title: 'Third' })
    await profile.toggleLike(fresh)

    expect(profile.likedTrackIds.has(3)).toBe(false)
    expect(profile.likedTracks.some((track) => track.id === 3)).toBe(false)

    const notifications = useNotificationsStore()
    expect(notifications.notifications.some((n) => n.type === 'error')).toBe(true)
  })

  it('rolls back the optimistic remove when the API fails', async () => {
    mockedRemove.mockRejectedValueOnce(new Error('fail'))
    const profile = useProfileStore()
    await profile.loadProfile()

    const liked = createTrack({ id: 1 })
    await profile.toggleLike(liked)

    expect(profile.likedTrackIds.has(1)).toBe(true)
    expect(profile.likedTracks.some((track) => track.id === 1)).toBe(true)
  })

  it('ignores double toggle while a request is in flight', async () => {
    let resolveAdd: (() => void) | undefined
    mockedAdd.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAdd = () => resolve(undefined)
        }) as never,
    )
    const profile = useProfileStore()
    await profile.loadProfile()

    const fresh = createTrack({ id: 3, title: 'Third' })
    const first = profile.toggleLike(fresh)
    const second = profile.toggleLike(fresh)
    resolveAdd?.()
    await Promise.all([first, second])

    expect(mockedAdd).toHaveBeenCalledTimes(1)
    expect(profile.likedTrackIds.has(3)).toBe(true)
  })

  it('refreshes likes and stats independently', async () => {
    const profile = useProfileStore()
    await profile.loadProfile()

    mockedFetchLikes.mockResolvedValueOnce({
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
    })
    await profile.refreshLikes()
    // refreshLikes обновляет только постраничный список; сердечки живут из /likes/ids.
    expect(profile.likedTracks).toHaveLength(0)
    expect(profile.likesTotal).toBe(0)
    expect(profile.likedTrackIds.size).toBe(2)

    mockedStats.mockResolvedValueOnce(statsFixture({ play_count: 10 }))
    await profile.refreshStats()
    expect(profile.stats?.play_count).toBe(10)
  })

  it('loads the next likes page on demand and deduplicates parallel calls', async () => {
    const profile = useProfileStore()
    // Первая партия заполнена до лимита — есть что догружать.
    mockedFetchLikes.mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, index) => ({
        track: createTrack({ id: index + 1 }),
        created_at: '2026-09-01T00:00:00Z',
      })),
      total: 60,
      limit: 50,
      offset: 0,
    })
    await profile.loadProfile()

    expect(profile.hasMoreLikes).toBe(true)
    expect(profile.likesTotal).toBe(60)

    let resolveNext: (() => void) | undefined
    mockedFetchLikes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNext = () =>
            resolve({
              items: Array.from({ length: 10 }, (_, index) => ({
                track: createTrack({ id: 51 + index }),
                created_at: '2026-09-02T00:00:00Z',
              })),
              total: 60,
              limit: 50,
              offset: 50,
            })
        }) as never,
    )

    const first = profile.loadNextLikes()
    const second = profile.loadNextLikes()
    resolveNext?.()
    await Promise.all([first, second])

    expect(mockedFetchLikes).toHaveBeenCalledTimes(2)
    expect(mockedFetchLikes).toHaveBeenLastCalledWith({ limit: 50, offset: 50 })
    expect(profile.likedTracks).toHaveLength(60)
    expect(profile.likesCursor).toBe(60)
    expect(profile.hasMoreLikes).toBe(false)
  })

  it('filters duplicates when appending the next likes page', async () => {
    const profile = useProfileStore()
    // Заполняем первую партию до лимита, чтобы сентинел-ветка была активна.
    mockedFetchLikes.mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, index) => ({
        track: createTrack({ id: index + 1 }),
        created_at: '2026-09-01T00:00:00Z',
      })),
      total: 52,
      limit: 50,
      offset: 0,
    })
    await profile.loadProfile()

    // Сервер вернул дубликаты уже известных треков (offset-пагинация после удаления).
    mockedFetchLikes.mockResolvedValueOnce({
      items: [
        { track: createTrack({ id: 1, title: 'Dup' }), created_at: '2026-09-01T00:00:00Z' },
        { track: createTrack({ id: 51, title: 'Fifty-First' }), created_at: '2026-09-03T00:00:00Z' },
      ],
      total: 52,
      limit: 50,
      offset: 50,
    })
    await profile.loadNextLikes()

    expect(profile.likedTracks).toHaveLength(51)
    expect(profile.likedTracks.filter((track) => track.id === 1)).toHaveLength(1)
    expect(profile.likesCursor).toBe(52)
    expect(profile.hasMoreLikes).toBe(false)
  })

  it('sets a likes error when the next page fails', async () => {
    const profile = useProfileStore()
    mockedFetchLikes.mockResolvedValueOnce({
      items: Array.from({ length: 50 }, (_, index) => ({
        track: createTrack({ id: index + 1 }),
        created_at: '2026-09-01T00:00:00Z',
      })),
      total: 60,
      limit: 50,
      offset: 0,
    })
    await profile.loadProfile()

    mockedFetchLikes.mockRejectedValueOnce(new Error('fail'))
    await profile.loadNextLikes()

    expect(profile.likesError).toBe('Не удалось загрузить любимые треки')
    expect(profile.likedTracks).toHaveLength(50)
    expect(profile.hasMoreLikes).toBe(true)
  })

  it('resets state on session teardown', async () => {
    const profile = useProfileStore()
    const auth = useAuthStore()
    await profile.loadProfile()

    auth.markUnauthenticated()

    expect(profile.stats).toBeNull()
    expect(profile.likedTrackIds.size).toBe(0)
    expect(profile.isLoaded).toBe(false)
  })
})
