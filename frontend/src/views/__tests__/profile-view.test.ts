import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchLikes, fetchLikedTrackIds, removeLike } from '@/api/likes-api'
import { fetchListeningStats } from '@/api/events-api'
import { fetchPlaylists } from '@/api/playlists-api'
import ProfileView from '../ProfileView.vue'
import { useAuthStore } from '@/stores/auth.store'
import { usePlayerStore } from '@/stores/player.store'
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

vi.mock('@/api/playlists-api', () => ({
  fetchPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  fetchPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addPlaylistTrack: vi.fn(),
  removePlaylistTrack: vi.fn(),
  reorderPlaylistTracks: vi.fn(),
  createShareLink: vi.fn(),
  revokeShareLink: vi.fn(),
}))

const mockedStats = vi.mocked(fetchListeningStats)
const mockedFetchLikes = vi.mocked(fetchLikes)
const mockedFetchLikedTrackIds = vi.mocked(fetchLikedTrackIds)
const mockedRemove = vi.mocked(removeLike)
const mockedFetchPlaylists = vi.mocked(fetchPlaylists)

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
    top_tracks: [
      { track: createTrack({ id: 10, title: 'Top Song' }), play_count: 3, listened_seconds: 5400 },
    ],
    ...overrides,
  }
}

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.currentUser = { id: 1, username: 'alice' }
  auth.initialized = true

  const wrapper = mount(ProfileView, { global: { plugins: [pinia] } })
  await flushPromises()
  const player = usePlayerStore()

  return { wrapper, auth, player }
}

describe('ProfileView (личный кабинет)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockedStats.mockResolvedValue(statsFixture())
    mockedFetchLikedTrackIds.mockResolvedValue([1])
    mockedFetchLikes.mockResolvedValue({
      items: [{ track: createTrack(), created_at: '2026-09-01T00:00:00Z' }],
      total: 1,
      limit: 50,
      offset: 0,
    })
    mockedFetchPlaylists.mockResolvedValue({ items: [], total: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reloads stats and likes on every mount of the view', async () => {
    const first = await mountView()
    first.wrapper.unmount()

    expect(mockedStats).toHaveBeenCalledTimes(1)
    expect(mockedFetchLikes).toHaveBeenCalledTimes(1)

    await mountView()

    expect(mockedStats).toHaveBeenCalledTimes(2)
    expect(mockedFetchLikes).toHaveBeenCalledTimes(2)
  })

  it('shows the stats spinner while the profile is reloading', async () => {
    let resolveStats: ((value: ListeningStats) => void) | undefined
    mockedStats.mockImplementationOnce(
      () =>
        new Promise<ListeningStats>((resolve) => {
          resolveStats = resolve
        }) as never,
    )
    // Лайки тоже висят: обе секции в ожидании.
    let resolveLikes: ((value: { items: never[]; total: number; limit: number; offset: number }) => void) | undefined
    mockedFetchLikes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLikes = resolve
        }) as never,
    )

    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.currentUser = { id: 1, username: 'alice' }
    auth.initialized = true

    const wrapper = mount(ProfileView, { global: { plugins: [pinia] } })
    // Даём микротаскам выполниться: isStatsLoading/isLoadingLikes стали true,
    // но промисы ещё не разрешены.
    await flushPromises()

    // Данные ещё не пришли — секция статистики показывает спиннер.
    expect(wrapper.text()).toContain('Загружаем статистику…')
    expect(wrapper.find('.stats-grid').exists()).toBe(false)

    resolveStats?.(statsFixture())
    resolveLikes?.({ items: [], total: 0, limit: 50, offset: 0 })
    await flushPromises()

    expect(wrapper.text()).not.toContain('Загружаем статистику…')
    expect(wrapper.find('.stats-grid').exists()).toBe(true)
  })

  it('greets the user by name instead of a generic title', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.get('h1').text()).toBe('Привет, alice')
  })

  it('orders sections: stats, playlists, likes', async () => {
    const { wrapper } = await mountView()

    const headings = wrapper.findAll('h2').map((heading) => heading.text())
    expect(headings).toEqual([
      expect.stringContaining('Статистика'),
      'Плейлисты',
      expect.stringContaining('Любимое'),
    ])
  })

  it('hides the password change form', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.find('#current-password').exists()).toBe(false)
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
  })

  it('keeps the logout button available', async () => {
    const { wrapper, auth } = await mountView()
    const logoutSpy = vi.spyOn(auth, 'logout').mockResolvedValue(undefined)

    const logoutButton = wrapper.findAll('button').find((button) => button.text() === 'Выйти')
    await logoutButton?.trigger('click')
    await flushPromises()

    expect(logoutSpy).toHaveBeenCalled()
  })

  it('shows listening stats and top tracks without per-track time', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.text()).toContain('запусков')
    expect(wrapper.text()).toContain('1 ч 30 мин')
    expect(wrapper.text()).toContain('Top Song')
    expect(wrapper.text()).toContain('Топ треков')
    // Время прослушивания у трека в топе больше не отображается.
    expect(wrapper.find('.stats-top__time').exists()).toBe(false)
    expect(wrapper.find('.stats-top__time-unit').exists()).toBe(false)
  })

  it('shows the playlists section with a create tile', async () => {
    const { wrapper } = await mountView()

    expect(wrapper.text()).toContain('Плейлисты')
    expect(wrapper.find('.playlist-tile--create').exists()).toBe(true)
  })

  it('shows an empty likes state when nothing is liked', async () => {
    mockedFetchLikes.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 })
    const { wrapper } = await mountView()

    expect(wrapper.text()).toContain('Пока пусто')
    expect(wrapper.text()).toContain('сердечком')
  })

  it('plays a liked track from the favorites list', async () => {
    const { wrapper, player } = await mountView()

    const rows = wrapper.findAll('.track-row')
    expect(rows.length).toBe(1)
    await rows[0]?.trigger('click')

    expect(player.currentTrack?.id).toBe(1)
    expect(player.isLoading).toBe(true)
  })

  it('removes a like from the favorites list on heart click', async () => {
    const { wrapper } = await mountView()

    const heart = wrapper.get('.track-row__action--like')
    await heart.trigger('click')
    await flushPromises()

    expect(mockedRemove).toHaveBeenCalledWith(1)
  })

  it('shows the likes counter when there are liked tracks', async () => {
    mockedFetchLikes.mockResolvedValue({
      items: [
        { track: createTrack({ id: 1 }), created_at: '2026-09-01T00:00:00Z' },
        { track: createTrack({ id: 2, title: 'Second' }), created_at: '2026-09-02T00:00:00Z' },
      ],
      total: 2,
      limit: 50,
      offset: 0,
    })
    const { wrapper } = await mountView()

    expect(wrapper.get('.settings-section__counter').text()).toBe('2')
  })

  it('renders the scroll sentinel when more likes are available', async () => {
    mockedFetchLikes.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => ({
        track: createTrack({ id: index + 1 }),
        created_at: '2026-09-01T00:00:00Z',
      })),
      total: 55,
      limit: 50,
      offset: 0,
    })
    const { wrapper } = await mountView()

    expect(wrapper.find('.library-view__sentinel').exists()).toBe(true)
  })

  it('polls stats every 30 seconds while the view is open', async () => {
    const { wrapper } = await mountView()

    // mock.calls накапливается между тестами; считаем относительно маунта.
    const initialCalls = mockedStats.mock.calls.length

    await vi.advanceTimersByTimeAsync(30000)
    await flushPromises()
    expect(mockedStats.mock.calls.length).toBe(initialCalls + 1)

    await vi.advanceTimersByTimeAsync(30000)
    await flushPromises()
    expect(mockedStats.mock.calls.length).toBe(initialCalls + 2)

    // Ошибка опроса не ломает последующие тики.
    mockedStats.mockRejectedValueOnce(new Error('network'))
    await vi.advanceTimersByTimeAsync(30000)
    await flushPromises()
    expect(mockedStats.mock.calls.length).toBe(initialCalls + 3)

    await vi.advanceTimersByTimeAsync(30000)
    await flushPromises()
    expect(mockedStats.mock.calls.length).toBe(initialCalls + 4)

    wrapper.unmount()
  })

  it('stops polling stats after the view is unmounted', async () => {
    const { wrapper } = await mountView()
    const initialCalls = mockedStats.mock.calls.length

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(120000)
    await flushPromises()

    expect(mockedStats.mock.calls.length).toBe(initialCalls)
  })

  it('switches the stats period and refetches immediately', async () => {
    const { wrapper } = await mountView()
    const initialCalls = mockedStats.mock.calls.length

    const dayButton = wrapper.findAll('.stats-period__option').find((button) => button.text() === '24 часа')
    expect(dayButton).toBeDefined()
    await dayButton?.trigger('click')
    await flushPromises()

    expect(mockedStats).toHaveBeenLastCalledWith(1)
    expect(mockedStats.mock.calls.length).toBe(initialCalls + 1)
    expect(wrapper.get('#settings-stats').text()).toBe('Статистика за 24 часа')

    // Поллинг продолжает работать с выбранным периодом.
    await vi.advanceTimersByTimeAsync(30000)
    await flushPromises()
    expect(mockedStats).toHaveBeenLastCalledWith(1)

    wrapper.unmount()
  })

  it('marks the selected period option as active', async () => {
    const { wrapper } = await mountView()

    const options = wrapper.findAll('.stats-period__option')
    expect(options).toHaveLength(3)
    expect(wrapper.get('.stats-period__option--active').text()).toBe('7 дней')

    const dayButton = options.find((button) => button.text() === '24 часа')
    await dayButton?.trigger('click')
    await flushPromises()

    expect(wrapper.get('.stats-period__option--active').text()).toBe('24 часа')
  })

  it('loads the next likes page when the sentinel intersects', async () => {
    mockedFetchLikes.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, index) => ({
        track: createTrack({ id: index + 1 }),
        created_at: '2026-09-01T00:00:00Z',
      })),
      total: 51,
      limit: 50,
      offset: 0,
    })
    const { wrapper } = await mountView()

    mockedFetchLikes.mockResolvedValueOnce({
      items: [{ track: createTrack({ id: 51, title: 'Fifty-First' }), created_at: '2026-09-02T00:00:00Z' }],
      total: 51,
      limit: 50,
      offset: 50,
    })

    // jsdom без IntersectionObserver: дергаем дозагрузку так же, как сентинел.
    const { useProfileStore } = await import('@/stores/profile.store')
    const profile = useProfileStore()
    await profile.loadNextLikes()
    await flushPromises()

    expect(mockedFetchLikes).toHaveBeenLastCalledWith({ limit: 50, offset: 50 })
    expect(profile.likedTracks).toHaveLength(51)
    expect(wrapper.findAll('.track-row')).toHaveLength(51)
  })
})
