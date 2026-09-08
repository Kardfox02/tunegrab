import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import { useLibraryStore, LIBRARY_PAGE_LIMIT } from '@/stores/library.store'
import { usePlayerStore } from '@/stores/player.store'
import type { Track } from '@/types/track'

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

function jsonResponse(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosResponse {
  return { data, status, statusText: String(status), headers: {}, config }
}

function errorResponse(
  status: number,
  detail: string,
  config: InternalAxiosRequestConfig,
): AxiosError {
  return new AxiosError(detail, 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: detail,
    headers: {},
    config,
    data: { detail },
  })
}

describe('library store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    apiClient.defaults.adapter = undefined
  })

  it('loads a page and applies route query parameters', async () => {
    const calls: Array<{ url?: string; params?: unknown }> = []
    apiClient.defaults.adapter = async (config) => {
      calls.push({ url: config.url, params: config.params })
      return jsonResponse(config, 200, {
        items: [createTrack()],
        total: 1,
        limit: LIBRARY_PAGE_LIMIT,
        offset: 0,
      })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({ q: 'metal', sort_by: 'title', order: 'asc', page: '2' })
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))
    await vi.waitFor(() => expect(library.isLoading).toBe(false))

    expect(calls[0]?.url).toBe('/tracks')
    // `page` больше не входит в URL-контракт: загрузка всегда с offset 0.
    expect(calls[0]?.params).toEqual({
      q: 'metal',
      sort_by: 'title',
      order: 'asc',
      limit: LIBRARY_PAGE_LIMIT,
      offset: 0,
    })
    expect(library.tracks).toHaveLength(1)
    expect(library.total).toBe(1)
    expect(library.hasMore).toBe(false)
  })

  it('falls back to defaults for invalid route values', async () => {
    const calls: Array<{ params?: unknown }> = []
    apiClient.defaults.adapter = async (config) => {
      calls.push({ params: config.params })
      return jsonResponse(config, 200, { items: [], total: 0, limit: LIBRARY_PAGE_LIMIT, offset: 0 })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({ q: null, sort_by: 'hacker', order: 'sideways', page: 'zero' })
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))

    expect(calls[0]?.params).toMatchObject({ sort_by: 'created_at', order: 'desc', offset: 0 })
    expect(library.query).toBe('')
    expect(library.page).toBe(1)
  })

  it('ignores stale page responses', async () => {
    const signals: AbortSignal[] = []
    const deferred: Array<(response: { items: Track[]; total: number; limit: number; offset: number }) => void> = []
    apiClient.defaults.adapter = async (config) => {
      signals.push(config.signal as AbortSignal)
      return new Promise((resolve) => {
        deferred.push((response) => resolve(jsonResponse(config, 200, response)))
      })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({ page: '1' })
    library.applyRouteQuery({ page: '2' })

    deferred[0]?.({ items: [createTrack({ id: 1, title: 'Stale' })], total: 1, limit: LIBRARY_PAGE_LIMIT, offset: 0 })
    await flushPromises()
    deferred[1]?.({ items: [createTrack({ id: 2, title: 'Fresh' })], total: 1, limit: LIBRARY_PAGE_LIMIT, offset: LIBRARY_PAGE_LIMIT })
    await flushPromises()

    expect(signals[0]?.aborted).toBe(true)
    expect(library.tracks[0]?.title).toBe('Fresh')
  })

  it('exposes load errors and recovers on retry', async () => {
    let attempts = 0
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/tracks') {
        attempts += 1
        if (attempts === 1) {
          throw errorResponse(500, 'Backend exploded', config)
        }
        return jsonResponse(config, 200, { items: [createTrack()], total: 1, limit: LIBRARY_PAGE_LIMIT, offset: 0 })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({})
    await vi.waitFor(() => expect(library.error?.detail).toBe('Backend exploded'))
    expect(library.tracks).toHaveLength(0)

    await library.load()

    expect(library.error).toBeNull()
    expect(library.tracks).toHaveLength(1)
  })

  it('deletes a track after successful 204, removes it locally and keeps the loaded list', async () => {
    const player = usePlayerStore()
    const playerController = {
      load: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
    }
    player.bindAudioController(playerController)
    player.playTrack(createTrack({ id: 1 }))

    const deletedIds = new Set<number>()
    let trackLoads = 0
    apiClient.defaults.adapter = async (config) => {
      if (config.method === 'delete') {
        deletedIds.add(Number((config.url ?? '').split('/').pop()))
        return jsonResponse(config, 204, undefined)
      }
      if (config.method === 'get' && config.url === '/tracks') {
        trackLoads += 1
        return jsonResponse(config, 200, {
          items: [createTrack({ id: 1 }), createTrack({ id: 2 })],
          total: 2,
          limit: LIBRARY_PAGE_LIMIT,
          offset: 0,
        })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({})
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))
    expect(trackLoads).toBe(1)

    await library.removeTrack(1)

    expect(library.tracks.map((track) => track.id)).toEqual([2])
    expect(library.total).toBe(1)
    expect(library.hasMore).toBe(false)
    expect(trackLoads).toBe(1)
    expect(player.currentTrack).toBeNull()
    expect(playerController.pause).toHaveBeenCalledOnce()
    expect(library.deleteError).toBeNull()
  })

  it('keeps the track and shows a message on 409', async () => {
    apiClient.defaults.adapter = async (config) => {
      if (config.method === 'delete') {
        throw errorResponse(409, 'Track files could not be removed', config)
      }
      return jsonResponse(config, 200, {
        items: [createTrack()],
        total: 1,
        limit: LIBRARY_PAGE_LIMIT,
        offset: 0,
      })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({})
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))

    await library.removeTrack(1)

    expect(library.tracks).toHaveLength(1)
    expect(library.deleteError?.id).toBe(1)
    expect(library.deleteError?.message).toContain('Файл используется плеером')
  })

  it('appends the next page via loadNextPage and stops at the end', async () => {
    const catalog = Array.from({ length: 60 }, (_, index) =>
      createTrack({
        id: index + 1,
        title: `Track ${index + 1}`,
        audio_url: `/stream/${index + 1}`,
      }),
    )
    apiClient.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/tracks') {
        const params = (config.params ?? {}) as Record<string, string | number>
        const offset = Number(params.offset ?? 0)
        const limit = Number(params.limit ?? LIBRARY_PAGE_LIMIT)
        return jsonResponse(config, 200, {
          items: catalog.slice(offset, offset + limit),
          total: catalog.length,
          limit,
          offset,
        })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({})
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))
    expect(library.tracks).toHaveLength(50)
    expect(library.hasMore).toBe(true)

    const firstBatch = await library.loadNextPage()

    expect(firstBatch.map((track) => track.id)).toEqual(
      Array.from({ length: 10 }, (_, index) => index + 51),
    )
    expect(library.tracks).toHaveLength(60)
    expect(library.hasMore).toBe(false)

    const secondBatch = await library.loadNextPage()
    expect(secondBatch).toHaveLength(0)
  })

  it('deduplicates concurrent loadNextPage requests', async () => {
    const catalog = Array.from({ length: 60 }, (_, index) =>
      createTrack({ id: index + 1, audio_url: `/stream/${index + 1}` }),
    )
    let trackCalls = 0
    apiClient.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/tracks') {
        const params = (config.params ?? {}) as Record<string, string | number>
        const offset = Number(params.offset ?? 0)
        trackCalls += 1
        return jsonResponse(config, 200, {
          items: catalog.slice(offset, offset + LIBRARY_PAGE_LIMIT),
          total: catalog.length,
          limit: LIBRARY_PAGE_LIMIT,
          offset,
        })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({})
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))

    const [first, second] = await Promise.all([library.loadNextPage(), library.loadNextPage()])

    expect(first).toEqual(second)
    expect(library.tracks).toHaveLength(60)
  })

  it('skips tracks already in the list when appending the next page', async () => {
    const catalog = Array.from({ length: 60 }, (_, index) =>
      createTrack({ id: index + 1, title: `Track ${index + 1}` }),
    )
    apiClient.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/tracks') {
        const params = (config.params ?? {}) as Record<string, string | number>
        const offset = Number(params.offset ?? 0)
        // Offset-пагинация со сдвигом после удалений: партия содержит дубли.
        const shifted = offset > 0 ? offset - 2 : offset
        return jsonResponse(config, 200, {
          items: catalog.slice(shifted, shifted + LIBRARY_PAGE_LIMIT),
          total: catalog.length,
          limit: LIBRARY_PAGE_LIMIT,
          offset,
        })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({})
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))
    expect(library.tracks).toHaveLength(50)

    // Локальное удаление двух треков: список 48, но серверный offset не сдвигается.
    await library.removeTrack(1)
    await library.removeTrack(2)
    expect(library.tracks).toHaveLength(48)

    const batch = await library.loadNextPage()

    expect(library.tracks.map((track) => track.id)).toEqual(
      Array.from({ length: 60 }, (_, index) => index + 1).filter((id) => id > 2),
    )
    expect(batch.every((track) => !['1', '2'].includes(String(track.id)))).toBe(true)
    expect(library.hasMore).toBe(false)
  })

  it('loads the first page with offset 0 regardless of internal page counter', async () => {
    const offsets: number[] = []
    apiClient.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/tracks') {
        const params = (config.params ?? {}) as Record<string, string | number>
        offsets.push(Number(params.offset ?? 0))
        return jsonResponse(config, 200, { items: [], total: 0, limit: LIBRARY_PAGE_LIMIT, offset: 0 })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({ page: '2' })
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))
    await library.load()

    expect(offsets).toEqual([0, 0])
    expect(library.page).toBe(1)
  })

  it('discards an in-flight prefetch when a normal load replaces the list', async () => {
    const catalog = Array.from({ length: 60 }, (_, index) =>
      createTrack({ id: index + 1, title: `Track ${index + 1}`, audio_url: `/stream/${index + 1}` }),
    )
    const deferred: Array<{
      offset: number
      resolve: (response: { items: Track[]; total: number; limit: number; offset: number }) => void
    }> = []
    apiClient.defaults.adapter = async (config) => {
      if (config.method === 'get' && config.url === '/tracks') {
        const params = (config.params ?? {}) as Record<string, string | number>
        const offset = Number(params.offset ?? 0)
        return new Promise((resolve) => {
          deferred.push({ offset, resolve: (response) => resolve(jsonResponse(config, 200, response)) })
        })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    const library = useLibraryStore()
    library.applyRouteQuery({})
    const initialLoad = deferred.find((entry) => entry.offset === 0)
    initialLoad?.resolve({ items: catalog.slice(0, LIBRARY_PAGE_LIMIT), total: catalog.length, limit: LIBRARY_PAGE_LIMIT, offset: 0 })
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))

    const prefetchPromise = library.loadNextPage()
    const prefetchEntry = deferred.find((entry) => entry.offset === LIBRARY_PAGE_LIMIT)
    expect(prefetchEntry).toBeDefined()

    // Пользователь меняет поиск — обычная загрузка отменяет prefetch.
    library.applyRouteQuery({ q: 'metal' })
    const reloadEntry = deferred.find((entry) => entry.offset === 0 && entry !== initialLoad)
    reloadEntry?.resolve({ items: [createTrack({ id: 999, title: 'Fresh' })], total: 1, limit: LIBRARY_PAGE_LIMIT, offset: 0 })
    await vi.waitFor(() => expect(library.tracks[0]?.title).toBe('Fresh'))
    await flushPromises()

    // Запоздавший ответ prefetch больше не дописывается в список.
    prefetchEntry?.resolve({ items: catalog.slice(LIBRARY_PAGE_LIMIT), total: catalog.length, limit: LIBRARY_PAGE_LIMIT, offset: LIBRARY_PAGE_LIMIT })
    await prefetchPromise
    await flushPromises()

    expect(library.tracks).toHaveLength(1)
    expect(library.tracks[0]?.title).toBe('Fresh')
    expect(library.hasMore).toBe(false)
  })

  it('resets the store on session teardown', async () => {
    apiClient.defaults.adapter = async (config) =>
      jsonResponse(config, 200, { items: [createTrack()], total: 1, limit: LIBRARY_PAGE_LIMIT, offset: 0 })

    const auth = useAuthStore()
    const library = useLibraryStore()
    library.applyRouteQuery({ q: 'metal' })
    await vi.waitFor(() => expect(library.isInitialized).toBe(true))

    auth.markUnauthenticated()

    expect(library.tracks).toHaveLength(0)
    expect(library.query).toBe('')
    expect(library.page).toBe(1)
    expect(library.isLoadingNextPage).toBe(false)
    expect(library.isInitialized).toBe(false)
  })
})
