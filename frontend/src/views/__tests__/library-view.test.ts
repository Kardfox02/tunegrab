import { flushPromises, mount } from '@vue/test-utils'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import { apiClient } from '@/api/client'
import { useDownloadsStore } from '@/stores/downloads.store'
import { useLibraryStore, LIBRARY_PAGE_LIMIT } from '@/stores/library.store'
import { usePlayerStore } from '@/stores/player.store'
import type { Track } from '@/types/track'
import LibraryView from '../LibraryView.vue'

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = []

  callback: IntersectionObserverCallback
  observed: Element[] = []

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    MockIntersectionObserver.instances.push(this)
  }

  observe(element: Element): void {
    this.observed.push(element)
  }

  disconnect(): void {
    this.observed = []
  }

  unobserve(): void {}

  trigger(isIntersecting: boolean): void {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

function stubIntersectionObserver(): void {
  MockIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
}

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    youtube_id: 'video-1',
    title: 'Blue Song',
    author: 'Alice',
    duration: 201,
    status: 'done',
    progress: 100,
    file_size: 1024,
    created_at: '2026-09-01T00:00:00Z',
    audio_url: '/stream/1',
    cover_url: null,
    ...overrides,
  }
}

function jsonResponse(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosResponse {
  return { data, status, statusText: String(status), headers: {}, config }
}

describe('LibraryView', () => {
  const deletedIds = new Set<number>()
  let busyId: number | null = null
  let librarySource: Track[] = []
  let totalCount: number | null = null

  beforeEach(() => {
    vi.useFakeTimers()
    deletedIds.clear()
    busyId = null
    totalCount = null
    librarySource = [
      createTrack({ id: 1, title: 'Blue Song', author: 'Alice' }),
      createTrack({ id: 2, title: 'Red Song', author: 'Bob', duration: 61 }),
    ]
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    apiClient.defaults.adapter = undefined
  })

  function makeAdapter() {
    return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
      if (config.method === 'get' && config.url === '/tracks') {
        const params = (config.params ?? {}) as Record<string, string | number>
        const q = String(params.q ?? '').toLowerCase()
        const offset = Number(params.offset ?? 0)
        const limit = Number(params.limit ?? LIBRARY_PAGE_LIMIT)
        const filtered = librarySource.filter(
          (track) =>
            !deletedIds.has(track.id) &&
            (q === '' ||
              track.title.toLowerCase().includes(q) ||
              track.author.toLowerCase().includes(q)),
        )
        const total = totalCount ?? filtered.length
        return jsonResponse(config, 200, {
          items: filtered.slice(offset, offset + limit),
          total,
          limit,
          offset,
        })
      }

      if (config.method === 'delete') {
        const id = Number((config.url ?? '').split('/').pop())
        if (id === busyId) {
          throw new AxiosError('Conflict', 'ERR_BAD_REQUEST', config, undefined, {
            status: 409,
            statusText: 'Conflict',
            headers: {},
            config,
            data: { detail: 'Track files could not be removed' },
          })
        }
        deletedIds.add(id)
        return jsonResponse(config, 204, undefined)
      }

      return jsonResponse(config, 404, { detail: 'Not found' })
    }
  }

  async function mountView(routeQuery = '') {
    setActivePinia(createPinia())
    apiClient.defaults.adapter = makeAdapter()
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/library', name: 'library', component: LibraryView },
        { path: '/search', name: 'search', component: { render: () => null } },
        { path: '/', redirect: '/library' },
      ],
    })
    await router.push(`/library${routeQuery}`)
    await router.isReady()

    const wrapper = mount(LibraryView, {
      global: { plugins: [router] },
    })
    await flushPromises()

    return { wrapper, router }
  }

  it('renders track rows with metadata and the library counter', async () => {
    const { wrapper } = await mountView()

    const rows = wrapper.findAll('.track-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]?.text()).toContain('Blue Song')
    expect(rows[0]?.text()).toContain('Alice')
    expect(rows[0]?.text()).toContain('3:21')
    expect(rows[1]?.text()).toContain('1:01')
    expect(wrapper.get('.library-view__counter').text()).toBe('2 трека')
  })

  it('pushes the debounced search into the route and reloads', async () => {
    const { wrapper, router } = await mountView()

    await wrapper.get('input[type="search"]').setValue('blue')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()

    expect(router.currentRoute.value.query.q).toBe('blue')
    expect(wrapper.findAll('.track-row')).toHaveLength(1)
    expect(wrapper.get('.library-view__counter').text()).toBe('1 трек')
  })

  it('syncs sort into the route query and hides the sentinel when the list is complete', async () => {
    const { wrapper, router } = await mountView()

    const sortButtons = wrapper.findAll('.segmented__button')
    await sortButtons[1]?.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ sort_by: 'title', order: 'asc' })

    // Всего 2 трека — всё загружено, сентинел не рендерится и `page` не в URL.
    expect(wrapper.find('.library-view__sentinel').exists()).toBe(false)
    expect(router.currentRoute.value.query.page).toBeUndefined()
  })

  it('renders the sentinel with a spinner while the next page loads', async () => {
    librarySource = Array.from({ length: 60 }, (_, index) =>
      createTrack({ id: index + 1, title: `Track ${index + 1}`, author: 'Artist' }),
    )
    const { wrapper } = await mountView()
    const library = useLibraryStore()
    expect(wrapper.find('.library-view__sentinel').exists()).toBe(true)

    library.isLoadingNextPage = true
    await flushPromises()

    const sentinel = wrapper.find('.library-view__sentinel')
    expect(sentinel.find('.spinner').exists()).toBe(true)

    library.isLoadingNextPage = false
    await flushPromises()
    expect(wrapper.find('.library-view__sentinel .spinner').exists()).toBe(false)
  })

  it('loads the next page through the intersection observer after the sentinel appears', async () => {
    stubIntersectionObserver()
    librarySource = Array.from({ length: 60 }, (_, index) =>
      createTrack({
        id: index + 1,
        title: `Track ${index + 1}`,
        author: 'Artist',
        audio_url: `/stream/${index + 1}`,
      }),
    )
    const { wrapper } = await mountView()
    const library = useLibraryStore()
    expect(library.tracks).toHaveLength(50)
    expect(wrapper.find('.library-view__sentinel').exists()).toBe(true)

    // Сентинел отрендерился после первой загрузки — наблюдатель должен быть
    // закреплён за ним именно watcher'ом, а не только в onMounted.
    expect(MockIntersectionObserver.instances).toHaveLength(1)
    const observer = MockIntersectionObserver.instances[0]
    expect(observer?.observed).toHaveLength(1)

    observer?.trigger(true)
    await flushPromises()

    expect(library.tracks).toHaveLength(60)
    expect(wrapper.findAll('.track-row')).toHaveLength(60)
    expect(wrapper.find('.library-view__sentinel').exists()).toBe(false)
  })

  it('ignores intersection callbacks while a page load is already running', async () => {
    stubIntersectionObserver()
    librarySource = Array.from({ length: 60 }, (_, index) =>
      createTrack({ id: index + 1, title: `Track ${index + 1}`, author: 'Artist' }),
    )
    const { wrapper } = await mountView()
    const library = useLibraryStore()

    library.isLoadingNextPage = true
    await flushPromises()
    MockIntersectionObserver.instances[0]?.trigger(true)
    await flushPromises()

    // Фильтр isDisabled: во время догрузки колбэк не запускает вторую партию.
    expect(library.tracks).toHaveLength(50)
    expect(wrapper.find('.library-view__sentinel .spinner').exists()).toBe(true)

    library.isLoadingNextPage = false
    await flushPromises()
  })

  it('does not load the next page when the sentinel leaves the viewport', async () => {
    stubIntersectionObserver()
    librarySource = Array.from({ length: 60 }, (_, index) =>
      createTrack({ id: index + 1, title: `Track ${index + 1}`, author: 'Artist' }),
    )
    const { wrapper } = await mountView()
    const library = useLibraryStore()

    MockIntersectionObserver.instances[0]?.trigger(false)
    await flushPromises()

    expect(library.tracks).toHaveLength(50)
    expect(wrapper.find('.library-view__sentinel').exists()).toBe(true)
  })

  it('plays a track through the player store', async () => {
    const { wrapper } = await mountView()
    const player = usePlayerStore()

    await wrapper.findAll('.track-row')[0]?.trigger('click')

    expect(player.currentTrack?.id).toBe(1)
    expect(player.isLoading).toBe(true)
  })

  it('pauses the current track on a second click instead of restarting it', async () => {
    const { wrapper } = await mountView()
    const player = usePlayerStore()
    const firstRow = wrapper.findAll('.track-row')[0]

    await firstRow?.trigger('click')
    player.audioPlaying()
    await flushPromises()
    expect(player.isPlaying).toBe(true)

    // Второй клик по играющему треку → пауза: isPlaying гаснет, трек не меняется.
    await firstRow?.trigger('click')
    player.audioPaused()
    await flushPromises()

    expect(player.isPlaying).toBe(false)
    expect(player.currentTrack?.id).toBe(1)
  })

  it('marks the current row with the current class and the equalizer', async () => {
    const { wrapper } = await mountView()
    const player = usePlayerStore()
    const rows = wrapper.findAll('.track-row')

    await rows[1]?.trigger('click')
    player.audioPlaying()
    await flushPromises()

    const currentRow = wrapper.findAll('.track-row')[1]
    expect(currentRow?.classes()).toContain('track-row--current')
    expect(currentRow?.find('.track-row__equalizer').exists()).toBe(true)
    expect(currentRow?.find('.track-row__cover-play').exists()).toBe(false)
    // Не-current строка — обычная кнопка плей без эквалайзера.
    expect(wrapper.findAll('.track-row')[0]?.find('.track-row__equalizer').exists()).toBe(false)
  })

  it('moves the current-row visualization to the next track after auto advance', async () => {
    librarySource = Array.from({ length: 60 }, (_, index) =>
      createTrack({
        id: index + 1,
        title: `Track ${index + 1}`,
        author: 'Artist',
        audio_url: `/stream/${index + 1}`,
      }),
    )
    const { wrapper } = await mountView()
    const player = usePlayerStore()
    const library = useLibraryStore()
    player.setQueueSupplier(() => library.loadNextPage())

    await wrapper.findAll('.track-row')[0]?.trigger('click')
    player.audioPlaying()
    await flushPromises()
    expect(wrapper.findAll('.track-row')[0]?.classes()).toContain('track-row--current')

    await player.audioEnded()
    player.audioPlaying()
    await flushPromises()

    // Автопереход: визуализация переехала на второй трек, у первого — нет.
    expect(player.currentTrack?.id).toBe(2)
    expect(wrapper.findAll('.track-row')[1]?.classes()).toContain('track-row--current')
    expect(wrapper.findAll('.track-row')[0]?.classes()).not.toContain('track-row--current')
    expect(wrapper.findAll('.track-row')[1]?.find('.track-row__equalizer').exists()).toBe(true)
  })

  it('continues playback into the appended page when the list runs out', async () => {
    librarySource = Array.from({ length: 60 }, (_, index) =>
      createTrack({
        id: index + 1,
        title: `Track ${index + 1}`,
        author: 'Artist',
        audio_url: `/stream/${index + 1}`,
      }),
    )
    const { wrapper } = await mountView()
    const player = usePlayerStore()
    const library = useLibraryStore()
    player.setQueueSupplier(() => library.loadNextPage())

    await wrapper.findAll('.track-row')[49]?.trigger('click')
    expect(player.currentTrack?.id).toBe(50)
    expect(player.queue).toHaveLength(0)

    await player.audioEnded()
    await flushPromises()

    expect(player.currentTrack?.id).toBe(51)
    expect(player.queue.map((track) => track.id)).toEqual([52, 53, 54, 55, 56, 57, 58, 59, 60])
    expect(wrapper.findAll('.track-row')).toHaveLength(60)
  })

  it('removes a track after 204 and clears it from the player', async () => {
    const { wrapper } = await mountView()
    const player = usePlayerStore()
    player.playTrack(createTrack({ id: 1 }))

    await wrapper.findAll('.track-row__action--delete')[0]?.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.track-row')).toHaveLength(1)
    expect(player.currentTrack).toBeNull()
    expect(wrapper.get('.library-view__counter').text()).toBe('1 трек')
  })

  it('shows live download progress for active tracks', async () => {
    const { wrapper } = await mountView()
    const downloads = useDownloadsStore()

    downloads.active = [
      createTrack({ id: 1, title: 'Blue Song', status: 'downloading', progress: 55, audio_url: null }),
    ]
    await flushPromises()

    const row = wrapper.findAll('.track-row')[0]
    const progress = row?.find('.track-row__progress')
    expect(progress?.exists()).toBe(true)
    expect(progress?.text()).toContain('Загрузка')
    expect(progress?.text()).toContain('55%')
    expect(row?.find('.status-badge').exists()).toBe(false)
  })

  it('keeps the row and shows a message when deletion fails with 409', async () => {
    busyId = 1
    const { wrapper } = await mountView()

    await wrapper.findAll('.track-row__action--delete')[0]?.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.track-row')).toHaveLength(2)
    expect(wrapper.get('.track-row__error').text()).toContain('Файл используется плеером')
    expect(wrapper.get('.library-view__counter').text()).toBe('2 трека')
  })
})
