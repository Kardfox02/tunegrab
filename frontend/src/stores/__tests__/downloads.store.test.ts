import { flushPromises } from '@vue/test-utils'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import { useDownloadsStore } from '@/stores/downloads.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import type { Track } from '@/types/track'
import type { YouTubeSearchResult } from '@/types/youtube'

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    youtube_id: 'video-1',
    title: 'Song',
    author: 'Artist',
    duration: 200,
    status: 'downloading',
    progress: 40,
    file_size: null,
    created_at: '2026-09-05T00:00:00Z',
    audio_url: null,
    cover_url: null,
    ...overrides,
  }
}

function createResult(overrides: Partial<YouTubeSearchResult> = {}): YouTubeSearchResult {
  return {
    youtube_id: 'yt-new',
    title: 'New Song',
    author: 'Artist',
    duration: 180,
    thumbnail_url: null,
    webpage_url: 'https://youtube.com/watch?v=yt-new',
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

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

let activeList: Track[]
let activeCallCount: number
let statusById: Map<number, Track>
let statusRequests: number[]
let statusSignals: AbortSignal[]
let libraryLoadCount: number
let hungRequests: Set<string>
let pendingResolvers: Array<{ key: string; resolve: (response: AxiosResponse) => void }>
let downloadIdSeq: number

function resolveHung(entryIndex: number, data: unknown): void {
  const entry = pendingResolvers[entryIndex]
  if (!entry) {
    throw new Error(`no hung request at ${entryIndex}`)
  }
  entry.resolve(jsonResponse({} as InternalAxiosRequestConfig, 200, data))
}

function installAdapter(): void {
  apiClient.defaults.adapter = async (config) => {
    const method = config.method ?? 'get'
    const url = config.url ?? ''
    const requestKey = `${method}:${url}`

    if (method === 'get' && url === '/tracks') {
      libraryLoadCount += 1
      return jsonResponse(config, 200, { items: [], total: 0, limit: 50, offset: 0 })
    }

    const statusMatch = url.match(/^\/youtube\/(\d+)$/)
    if (method === 'get' && statusMatch) {
      const id = Number(statusMatch[1])
      statusRequests.push(id)
      statusSignals.push(config.signal as AbortSignal)
      if (hungRequests.has(requestKey)) {
        return new Promise<AxiosResponse>((resolve) => {
          pendingResolvers.push({ key: requestKey, resolve })
        })
      }
      const track = statusById.get(id)
      if (!track) {
        return jsonResponse(config, 404, { detail: 'Track not found' })
      }
      return jsonResponse(config, 200, track)
    }

    if (hungRequests.has(requestKey)) {
      return new Promise<AxiosResponse>((resolve) => {
        pendingResolvers.push({ key: requestKey, resolve })
      })
    }

    if (method === 'get' && url === '/youtube/downloads/active') {
      activeCallCount += 1
      return jsonResponse(config, 200, { items: activeList })
    }

    if (method === 'post' && url === '/youtube/download') {
      const payload = JSON.parse(String(config.data)) as { youtube_id: string; title: string }
      downloadIdSeq += 1
      const id = downloadIdSeq
      if (payload.youtube_id === 'yt-exists') {
        const existing = createTrack({ id, youtube_id: payload.youtube_id, status: 'done', progress: 100 })
        statusById.set(id, existing)
        return jsonResponse(config, 202, { track: existing, queued: false })
      }
      const track = createTrack({ id, youtube_id: payload.youtube_id, title: payload.title, status: 'pending', progress: 0 })
      statusById.set(id, track)
      return jsonResponse(config, 202, { track, queued: true })
    }

    if (method === 'post' && url.startsWith('/youtube/cancel/')) {
      const id = Number(url.split('/').pop())
      const cancelled = createTrack({ ...(statusById.get(id) ?? createTrack({ id })), status: 'cancelled', progress: 0 })
      statusById.set(id, cancelled)
      return jsonResponse(config, 200, cancelled)
    }

    if (method === 'post' && url.startsWith('/youtube/retry/')) {
      const id = Number(url.split('/').pop())
      const retried = createTrack({ ...(statusById.get(id) ?? createTrack({ id })), status: 'pending', progress: 0 })
      statusById.set(id, retried)
      return jsonResponse(config, 200, retried)
    }

    return jsonResponse(config, 404, { detail: 'Not found' })
  }
}

describe('downloads store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    activeList = []
    activeCallCount = 0
    statusById = new Map()
    statusRequests = []
    statusSignals = []
    libraryLoadCount = 0
    hungRequests = new Set()
    pendingResolvers = []
    downloadIdSeq = 100
    setVisibility('visible')
    installAdapter()
  })

  afterEach(() => {
    useDownloadsStore().reset()
    vi.useRealTimers()
    apiClient.defaults.adapter = undefined
  })

  it('restores active downloads after auth and starts polling each', async () => {
    activeList = [
      createTrack({ id: 1, status: 'downloading', progress: 40 }),
      createTrack({ id: 2, status: 'converting', progress: 85 }),
    ]
    statusById.set(1, createTrack({ id: 1, status: 'downloading', progress: 41 }))
    statusById.set(2, createTrack({ id: 2, status: 'converting', progress: 86 }))

    const downloads = useDownloadsStore()
    await downloads.restore()
    await flushPromises()

    expect(downloads.isRestored).toBe(true)
    expect(downloads.active).toHaveLength(2)
    expect(activeCallCount).toBe(1)
    expect(statusRequests).toEqual([1, 2])

    await downloads.restore()
    await flushPromises()
    expect(activeCallCount).toBe(1)

    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(statusRequests).toEqual([1, 2, 1, 2])
    expect(downloads.activeById.get(1)?.progress).toBe(41)
  })

  it('links restored active downloads to their search results', async () => {
    activeList = [
      createTrack({ id: 1, youtube_id: 'yt-live', status: 'downloading', progress: 40 }),
    ]
    statusById.set(1, createTrack({ id: 1, status: 'downloading', progress: 41 }))

    const downloads = useDownloadsStore()
    await downloads.restore()
    await flushPromises()

    expect(downloads.stateForResult('yt-live')).toBe('queued')
    expect(downloads.activeTrackFor('yt-live')?.id).toBe(1)

    statusById.set(1, createTrack({ id: 1, status: 'done', progress: 100, audio_url: '/stream/1' }))
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()

    expect(downloads.stateForResult('yt-live')).toBe('exists')
  })

  it('finishes on done: refreshes the library, notifies and stops polling', async () => {
    activeList = [createTrack({ id: 1, status: 'downloading', progress: 40 })]
    statusById.set(1, createTrack({ id: 1, status: 'done', progress: 100, audio_url: '/stream/1' }))

    const downloads = useDownloadsStore()
    await downloads.restore()
    await flushPromises()

    expect(downloads.active).toHaveLength(0)
    expect(libraryLoadCount).toBe(1)
    const notifications = useNotificationsStore().notifications
    expect(notifications.some((item) => item.type === 'success' && item.message.includes('Загрузка завершена'))).toBe(true)

    const requestsAtStop = statusRequests.length
    await vi.advanceTimersByTimeAsync(15000)
    await flushPromises()
    expect(statusRequests.length).toBe(requestsAtStop)
  })

  it('stops on error and warns without refreshing the library', async () => {
    activeList = [createTrack({ id: 1, status: 'downloading', progress: 40 })]
    statusById.set(1, createTrack({ id: 1, status: 'error', progress: 30 }))

    const downloads = useDownloadsStore()
    await downloads.restore()
    await flushPromises()

    expect(downloads.active).toHaveLength(0)
    expect(libraryLoadCount).toBe(0)
    const notifications = useNotificationsStore().notifications
    expect(notifications.some((item) => item.type === 'warning' && item.message.includes('Не удалось загрузить'))).toBe(true)

    const requestsAtStop = statusRequests.length
    await vi.advanceTimersByTimeAsync(15000)
    await flushPromises()
    expect(statusRequests.length).toBe(requestsAtStop)
  })

  it('queues a download, tracks it and marks deduplicated results as existing', async () => {
    const downloads = useDownloadsStore()

    await downloads.queueDownload(createResult({ youtube_id: 'yt-new', title: 'New Song' }))
    await flushPromises()

    expect(downloads.stateForResult('yt-new')).toBe('queued')
    expect(downloads.active.map((track) => track.id)).toEqual([101])
    expect(statusRequests).toEqual([101])

    statusById.set(101, createTrack({ id: 101, status: 'done', progress: 100, audio_url: '/stream/101' }))
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()

    expect(downloads.active).toHaveLength(0)
    expect(libraryLoadCount).toBe(1)
    expect(downloads.stateForResult('yt-new')).toBe('exists')

    await downloads.queueDownload(createResult({ youtube_id: 'yt-exists', title: 'Existing' }))
    await flushPromises()

    expect(downloads.stateForResult('yt-exists')).toBe('exists')
    expect(libraryLoadCount).toBe(1)
    expect(statusRequests).not.toContain(102)
  })

  it('returns the result button to idle when a linked download fails or is cancelled', async () => {
    const downloads = useDownloadsStore()

    await downloads.queueDownload(createResult({ youtube_id: 'yt-failure', title: 'Failing' }))
    await flushPromises()
    expect(downloads.stateForResult('yt-failure')).toBe('queued')

    statusById.set(101, createTrack({ id: 101, status: 'error', progress: 20 }))
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()

    expect(downloads.active).toHaveLength(0)
    expect(downloads.stateForResult('yt-failure')).toBe('idle')
  })

  it('ignores a stale status response that arrives after cancel', async () => {
    activeList = [createTrack({ id: 1, status: 'downloading', progress: 40 })]
    statusById.set(1, createTrack({ id: 1, status: 'downloading', progress: 40 }))
    hungRequests.add('get:/youtube/1')

    const downloads = useDownloadsStore()
    await downloads.restore()
    await flushPromises()
    expect(statusRequests).toEqual([1])

    statusById.set(1, createTrack({ id: 1, status: 'cancelled', progress: 0 }))
    await downloads.cancelDownload(1)
    await flushPromises()

    expect(downloads.active).toHaveLength(0)

    resolveHung(0, createTrack({ id: 1, status: 'downloading', progress: 40 }))
    await flushPromises()

    expect(downloads.active).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(15000)
    await flushPromises()
    expect(statusRequests).toEqual([1])
  })

  it('ignores responses from an older polling generation after restart', async () => {
    statusById.set(5, createTrack({ id: 5, status: 'downloading', progress: 10 }))
    hungRequests.add('get:/youtube/5')
    const downloads = useDownloadsStore()

    downloads.startPolling(5)
    await flushPromises()
    downloads.stopPolling(5)
    downloads.startPolling(5)
    await flushPromises()

    expect(statusRequests).toEqual([5, 5])

    resolveHung(0, createTrack({ id: 5, status: 'done', progress: 100 }))
    await flushPromises()
    expect(downloads.active).toHaveLength(0)
    expect(libraryLoadCount).toBe(0)

    resolveHung(1, createTrack({ id: 5, status: 'downloading', progress: 20 }))
    await flushPromises()
    expect(downloads.active).toHaveLength(1)
  })

  it('slows down in a hidden tab and refreshes immediately on return', async () => {
    activeList = [createTrack({ id: 1, status: 'downloading', progress: 40 })]
    statusById.set(1, createTrack({ id: 1, status: 'downloading', progress: 45 }))

    const downloads = useDownloadsStore()
    await downloads.restore()
    await flushPromises()
    expect(statusRequests).toEqual([1])

    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(1500)
    await flushPromises()
    expect(statusRequests).toEqual([1])

    await vi.advanceTimersByTimeAsync(10500)
    await flushPromises()
    expect(statusRequests).toEqual([1, 1])

    setVisibility('visible')
    await flushPromises()
    expect(statusRequests).toEqual([1, 1, 1])
  })

  it('clears timers and state on session teardown', async () => {
    activeList = [createTrack({ id: 1, status: 'downloading', progress: 40 })]
    statusById.set(1, createTrack({ id: 1, status: 'downloading', progress: 45 }))

    const auth = useAuthStore()
    const downloads = useDownloadsStore()
    await downloads.restore()
    await flushPromises()
    expect(downloads.active).toHaveLength(1)

    auth.markUnauthenticated()
    await flushPromises()

    expect(downloads.active).toHaveLength(0)
    expect(downloads.isRestored).toBe(false)

    const requestsAtReset = statusRequests.length
    await vi.advanceTimersByTimeAsync(15000)
    await flushPromises()
    expect(statusRequests.length).toBe(requestsAtReset)
  })

  it('retries a failed download and resumes polling', async () => {
    statusById.set(7, createTrack({ id: 7, status: 'error', progress: 30 }))
    const downloads = useDownloadsStore()

    await downloads.retryDownload(7)
    await flushPromises()

    expect(downloads.active.map((track) => track.id)).toEqual([7])
    expect(downloads.activeById.get(7)?.status).toBe('pending')
    expect(statusRequests).toEqual([7])
  })

  it('ignores a stale cancel response that arrives after retry', async () => {
    statusById.set(1, createTrack({ id: 1, status: 'downloading', progress: 40 }))
    hungRequests.add('post:/youtube/cancel/1')
    const downloads = useDownloadsStore()

    const cancelPromise = downloads.cancelDownload(1)
    await flushPromises()

    await downloads.retryDownload(1)
    await flushPromises()
    expect(downloads.active.map((track) => track.status)).toEqual(['pending'])

    resolveHung(0, createTrack({ id: 1, status: 'cancelled', progress: 0 }))
    await flushPromises()
    await cancelPromise

    expect(downloads.active.map((track) => track.status)).toEqual(['pending'])
  })

  it('ignores a stale retry response that arrives after cancel', async () => {
    statusById.set(2, createTrack({ id: 2, status: 'error', progress: 30 }))
    hungRequests.add('post:/youtube/retry/2')
    const downloads = useDownloadsStore()

    const retryPromise = downloads.retryDownload(2)
    await flushPromises()

    await downloads.cancelDownload(2)
    await flushPromises()
    expect(downloads.active).toHaveLength(0)

    resolveHung(0, createTrack({ id: 2, status: 'pending', progress: 0 }))
    await flushPromises()
    await retryPromise

    expect(downloads.active).toHaveLength(0)
  })

  it('ignores a download response that arrives after reset', async () => {
    hungRequests.add('post:/youtube/download')
    const downloads = useDownloadsStore()

    const queuePromise = downloads.queueDownload(createResult({ youtube_id: 'yt-late', title: 'Late' }))
    await flushPromises()

    downloads.reset()
    resolveHung(0, {
      track: createTrack({ id: 300, youtube_id: 'yt-late', status: 'pending', progress: 0 }),
      queued: true,
    })
    await flushPromises()
    await queuePromise

    expect(downloads.stateForResult('yt-late')).toBe('idle')
    expect(downloads.active).toHaveLength(0)
  })

  it('ignores a restore response that arrives after reset', async () => {
    activeList = [createTrack({ id: 1, status: 'downloading', progress: 40 })]
    hungRequests.add('get:/youtube/downloads/active')
    const downloads = useDownloadsStore()

    const restorePromise = downloads.restore()
    await flushPromises()

    downloads.reset()
    resolveHung(0, { items: activeList })
    await flushPromises()
    await restorePromise

    expect(downloads.active).toHaveLength(0)
    expect(downloads.isRestored).toBe(false)
  })

  it('aborts the in-flight status request when polling stops', async () => {
    statusById.set(9, createTrack({ id: 9, status: 'downloading', progress: 10 }))
    const downloads = useDownloadsStore()

    downloads.startPolling(9)
    await flushPromises()
    expect(statusRequests).toEqual([9])
    expect(statusSignals[0]?.aborted).toBe(false)

    downloads.stopPolling(9)

    expect(statusSignals[0]?.aborted).toBe(true)
    downloads.reset()
  })
})
