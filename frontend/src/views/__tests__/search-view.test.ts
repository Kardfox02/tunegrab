import { flushPromises, mount } from '@vue/test-utils'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/api/client'
import { useLibraryStore } from '@/stores/library.store'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import { useDownloadsStore } from '@/stores/downloads.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import type { Track } from '@/types/track'
import type { YouTubeSearchResult } from '@/types/youtube'
import SearchView from '../SearchView.vue'

function createResult(overrides: Partial<YouTubeSearchResult> = {}): YouTubeSearchResult {
  return {
    youtube_id: 'id-1',
    title: 'Song',
    author: 'Artist',
    duration: 201,
    thumbnail_url: null,
    webpage_url: 'https://youtube.com/watch?v=id-1',
    ...overrides,
  }
}

function trackFromPayload(payload: { youtube_id: string; title: string; author: string }, queued: boolean): Track {
  return {
    id: 9,
    youtube_id: payload.youtube_id,
    title: payload.title,
    author: payload.author,
    duration: 201,
    status: queued ? 'pending' : 'done',
    progress: 0,
    file_size: queued ? null : 1024,
    created_at: '2026-09-05T00:00:00Z',
    audio_url: queued ? null : '/stream/9',
    cover_url: null,
  }
}

function jsonResponse(config: InternalAxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  return { data, status, statusText: String(status), headers: {}, config }
}

function makeAdapter(results: YouTubeSearchResult[]) {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    if (config.url === '/youtube/search') {
      return jsonResponse(config, 200, { items: results })
    }
    const statusMatch = config.url?.match(/^\/youtube\/(\d+)$/)
    if (config.method === 'get' && statusMatch) {
      const track = trackFromPayload({ youtube_id: `id-${statusMatch[1]}`, title: 'Song', author: 'Artist' }, true)
      return jsonResponse(config, 200, { ...track, status: 'downloading', progress: 42 })
    }
    if (config.url === '/youtube/download') {
      const payload = JSON.parse(String(config.data)) as { youtube_id: string; title: string; author: string }
      if (payload.youtube_id === 'fail-id') {
        throw new AxiosError('Server Error', 'ERR_BAD_RESPONSE', config, undefined, {
          status: 500,
          statusText: 'Server Error',
          headers: {},
          config,
          data: { detail: 'Не удалось поставить загрузку в очередь' },
        })
      }
      const queued = payload.youtube_id !== 'exists-id'
      return jsonResponse(config, 202, { track: trackFromPayload(payload, queued), queued })
    }
    return jsonResponse(config, 404, { detail: 'Not found' })
  }
}

describe('SearchView', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    useDownloadsStore().reset()
    vi.useRealTimers()
    apiClient.defaults.adapter = undefined
  })

  async function mountWithResults(results: YouTubeSearchResult[], query = 'trip hop') {
    setActivePinia(createPinia())
    apiClient.defaults.adapter = makeAdapter(results)
    const wrapper = mount(SearchView)
    await wrapper.get('#youtube-search').setValue(query)
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()

    return wrapper
  }

  it('renders search results with metadata and links', async () => {
    const wrapper = await mountWithResults([
      createResult(),
      createResult({ youtube_id: 'id-2', title: 'Second Song', duration: 61 }),
    ])

    const cards = wrapper.findAll('.yt-card')
    expect(cards).toHaveLength(2)
    expect(cards[0]?.text()).toContain('Song')
    expect(cards[0]?.text()).toContain('Artist')
    expect(cards[0]?.text()).toContain('3:21')
    expect(cards[1]?.text()).toContain('1:01')
    expect(cards[0]?.find('.yt-card__thumb').attributes('href')).toBe('https://youtube.com/watch?v=id-1')
  })

  it('shows the empty state when nothing is found', async () => {
    const wrapper = await mountWithResults([])

    expect(wrapper.findComponent(EmptyState).exists()).toBe(true)
  })

  it('shows rate-limit details and recovers on retry', async () => {
    let searchAttempts = 0
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/youtube/search') {
        searchAttempts += 1
        if (searchAttempts === 1) {
          throw new AxiosError('Too Many Requests', 'ERR_BAD_REQUEST', config, undefined, {
            status: 429,
            statusText: 'Too Many Requests',
            headers: {},
            config,
            data: { detail: 'Too many search requests' },
          })
        }
        return jsonResponse(config, 200, { items: [createResult()] })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    setActivePinia(createPinia())
    const wrapper = mount(SearchView)
    await wrapper.get('#youtube-search').setValue('drum and bass')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    const errorBlock = wrapper.findComponent(ErrorState)
    expect(errorBlock.exists()).toBe(true)
    expect(errorBlock.text()).toContain('Too many search requests')

    await errorBlock.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('.yt-card')).toHaveLength(1)
  })

  it('queues downloads and reflects deduplicated results', async () => {
    const wrapper = await mountWithResults([
      createResult({ youtube_id: 'queued-id' }),
      createResult({ youtube_id: 'exists-id' }),
      createResult({ youtube_id: 'fail-id', title: 'Broken' }),
    ])

    const cards = wrapper.findAll('.yt-card')
    expect(cards[0]?.get('.yt-card__download').text()).toBe('Скачать')

    await cards[0]?.get('.yt-card__download').trigger('click')
    await flushPromises()
    const firstButton = cards[0]?.get('.yt-card__download')
    expect(firstButton?.text()).toBe('В очереди…')
    expect((firstButton?.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('.yt-card__progress').text()).toContain('42%')

    await cards[1]?.get('.yt-card__download').trigger('click')
    await flushPromises()
    expect(cards[1]?.get('.yt-card__download').text()).toBe('В библиотеке')

    await cards[2]?.get('.yt-card__download').trigger('click')
    await flushPromises()
    expect(cards[2]?.get('.yt-card__download-error').text()).toContain('Не удалось поставить загрузку в очередь')
    expect((cards[2]?.get('.yt-card__download').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('uploads a local mp3 and shows a success notification', async () => {
    const uploaded: string[] = []
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/tracks/upload') {
        if (uploaded.length > 0) {
          throw new AxiosError('Conflict', 'ERR_BAD_REQUEST', config, undefined, {
            status: 409,
            statusText: 'Conflict',
            headers: {},
            config,
            data: { detail: 'This track is already in the library' },
          })
        }
        uploaded.push('track')
        return jsonResponse(config, 201, trackFromPayload({ youtube_id: 'local_x', title: 'Song', author: 'Artist' }, false))
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    setActivePinia(createPinia())
    const wrapper = mount(SearchView)

    expect(wrapper.find('.search-view__upload').exists()).toBe(true)
    const button = wrapper.get('.search-view__upload .btn')
    expect(button.text()).toBe('Загрузить свой трек')

    const fileInput = wrapper.get('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['audio'], 'song.mp3', { type: 'audio/mpeg' })],
      configurable: true,
    })
    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()

    expect(uploaded).toHaveLength(1)
    expect(useNotificationsStore().notifications.some((n) => n.type === 'success')).toBe(true)
  })

  it('refreshes an initialized library after a successful upload', async () => {
    let uploadCount = 0
    let trackLoads = 0
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/tracks/upload') {
        uploadCount += 1
        return jsonResponse(config, 201, trackFromPayload({ youtube_id: 'local_x', title: 'Song', author: 'Artist' }, false))
      }
      if (config.method === 'get' && config.url === '/tracks') {
        trackLoads += 1
        return jsonResponse(config, 200, { items: [], total: 0, limit: 50, offset: 0 })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    setActivePinia(createPinia())
    const library = useLibraryStore()
    const wrapper = mount(SearchView)

    const fileInput = wrapper.get('input[type="file"]').element as HTMLInputElement
    const mediaFile = new File(['audio'], 'song.mp3', { type: 'audio/mpeg' })

    // Библиотека ещё не инициализирована — загрузка списка не нужна.
    Object.defineProperty(fileInput, 'files', { value: [mediaFile], configurable: true })
    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()
    expect(uploadCount).toBe(1)
    expect(trackLoads).toBe(0)

    // После посещения библиотеки upload обязан обновить список.
    library.isInitialized = true
    Object.defineProperty(fileInput, 'files', { value: [mediaFile], configurable: true })
    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()
    expect(uploadCount).toBe(2)
    expect(trackLoads).toBe(1)
  })

  it('shows an error notification when the upload fails', async () => {
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/tracks/upload') {
        throw new AxiosError('Conflict', 'ERR_BAD_REQUEST', config, undefined, {
          status: 409,
          statusText: 'Conflict',
          headers: {},
          config,
          data: { detail: 'This track is already in the library' },
        })
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    setActivePinia(createPinia())
    const wrapper = mount(SearchView)

    const fileInput = wrapper.get('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['audio'], 'song.mp3', { type: 'audio/mpeg' })],
      configurable: true,
    })
    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()

    const notifications = useNotificationsStore().notifications
    const errorNotification = notifications.find((n) => n.type === 'error')
    expect(errorNotification).toBeDefined()
    expect(errorNotification?.message).toContain('This track is already in the library')
  })

  it('disables the upload button while uploading', async () => {
    const resolveUploadRef: { value: (() => void) | null } = { value: null }
    apiClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/tracks/upload') {
        await new Promise<void>((resolve) => {
          resolveUploadRef.value = resolve
        })
        return jsonResponse(config, 201, trackFromPayload({ youtube_id: 'local_x', title: 'Song', author: 'Artist' }, false))
      }
      return jsonResponse(config, 404, { detail: 'Not found' })
    }

    setActivePinia(createPinia())
    const wrapper = mount(SearchView)

    const fileInput = wrapper.get('input[type="file"]').element as HTMLInputElement
    Object.defineProperty(fileInput, 'files', {
      value: [new File(['audio'], 'song.mp3', { type: 'audio/mpeg' })],
      configurable: true,
    })
    await wrapper.get('input[type="file"]').trigger('change')
    await flushPromises()

    const button = wrapper.get('.search-view__upload .btn')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    expect(button.text()).toBe('Загрузка…')

    resolveUploadRef.value?.()
    await flushPromises()
    expect((wrapper.get('.search-view__upload .btn').element as HTMLButtonElement).disabled).toBe(false)
  })
})
