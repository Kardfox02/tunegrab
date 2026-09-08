import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { useDebouncedSearch } from '@/composables/useDebouncedSearch'
import { ApiError } from '@/types/errors'
import type { YouTubeSearchResult } from '@/types/youtube'

function createResult(overrides: Partial<YouTubeSearchResult> = {}): YouTubeSearchResult {
  return {
    youtube_id: 'id-1',
    title: 'Song',
    author: 'Artist',
    duration: 200,
    thumbnail_url: null,
    webpage_url: 'https://youtube.com/watch?v=id-1',
    ...overrides,
  }
}

function setupHarness(searcher: Mock) {
  let exposed: ReturnType<typeof useDebouncedSearch<YouTubeSearchResult>> | undefined
  const wrapper = mount({
    setup() {
      exposed = useDebouncedSearch<YouTubeSearchResult>({
        search: (query, signal) => searcher(query, signal),
      })
      return () => null
    },
  })
  if (!exposed) {
    throw new Error('composable was not initialized')
  }
  return { wrapper, api: exposed }
}

describe('useDebouncedSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces scheduled searches', async () => {
    const searcher = vi.fn().mockResolvedValue([createResult()])
    const { api } = setupHarness(searcher)

    api.query.value = 'metal'
    api.schedule()

    await vi.advanceTimersByTimeAsync(349)
    expect(searcher).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(searcher).toHaveBeenCalledOnce()
    expect(searcher.mock.calls[0]?.[0]).toBe('metal')

    await flushPromises()
    expect(api.results.value).toHaveLength(1)
    expect(api.isLoading.value).toBe(false)
    expect(api.error.value).toBeNull()
  })

  it('does not search below the minimum length', async () => {
    const searcher = vi.fn().mockResolvedValue([])
    const { api } = setupHarness(searcher)

    api.query.value = 'a'
    api.schedule()
    await vi.advanceTimersByTimeAsync(400)

    expect(searcher).not.toHaveBeenCalled()
    expect(api.isQueryTooShort.value).toBe(true)
    expect(api.hasSearched.value).toBe(false)
  })

  it('submits immediately and cancels the pending timer', async () => {
    const searcher = vi.fn().mockResolvedValue([createResult()])
    const { api } = setupHarness(searcher)

    api.query.value = 'rock'
    api.schedule()
    api.submit()

    expect(searcher).toHaveBeenCalledOnce()
    expect(searcher.mock.calls[0]?.[0]).toBe('rock')

    await vi.advanceTimersByTimeAsync(500)
    expect(searcher).toHaveBeenCalledOnce()
  })

  it('ignores stale responses after a newer search', async () => {
    const signals: AbortSignal[] = []
    const deferred: Array<(items: YouTubeSearchResult[]) => void> = []
    const searcher = vi.fn().mockImplementation((_query: string, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<YouTubeSearchResult[]>((resolve) => {
        deferred.push(resolve)
      })
    })
    const { api } = setupHarness(searcher)

    api.query.value = 'first query'
    api.schedule()
    await vi.advanceTimersByTimeAsync(350)
    expect(searcher).toHaveBeenCalledTimes(1)

    api.query.value = 'second query'
    api.schedule()
    await vi.advanceTimersByTimeAsync(350)
    expect(searcher).toHaveBeenCalledTimes(2)
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)

    deferred[0]?.([createResult({ youtube_id: 'stale', title: 'Stale' })])
    await flushPromises()
    expect(api.results.value).toHaveLength(0)

    deferred[1]?.([createResult({ youtube_id: 'fresh', title: 'Fresh' })])
    await flushPromises()
    expect(api.results.value).toHaveLength(1)
    expect(api.results.value[0]?.youtube_id).toBe('fresh')
  })

  it('ignores aborted request errors', async () => {
    const searcher = vi.fn().mockRejectedValueOnce(new ApiError({ aborted: true }))
    const { api } = setupHarness(searcher)

    api.query.value = 'ambient'
    api.schedule()
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()

    expect(api.error.value).toBeNull()
    expect(api.isLoading.value).toBe(false)
    expect(api.hasSearched.value).toBe(true)
  })

  it('exposes errors and recovers on retry', async () => {
    const searcher = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ status: 500, detail: 'Backend exploded' }))
      .mockResolvedValueOnce([createResult()])
    const { api } = setupHarness(searcher)

    api.query.value = 'jazz'
    api.schedule()
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()

    expect(api.error.value?.detail).toBe('Backend exploded')
    expect(api.results.value).toHaveLength(0)

    api.submit()
    await flushPromises()

    expect(api.error.value).toBeNull()
    expect(api.results.value).toHaveLength(1)
  })

  it('aborts the in-flight request on unmount', async () => {
    const signals: AbortSignal[] = []
    const searcher = vi.fn().mockImplementation((_query: string, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<YouTubeSearchResult[]>(() => undefined)
    })
    const { wrapper, api } = setupHarness(searcher)

    api.query.value = 'long search'
    api.schedule()
    await vi.advanceTimersByTimeAsync(350)
    expect(searcher).toHaveBeenCalledOnce()

    wrapper.unmount()
    expect(signals[0]?.aborted).toBe(true)
  })
})
