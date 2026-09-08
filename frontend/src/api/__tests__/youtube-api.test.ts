import { afterEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client'
import { queueDownload, searchYouTube } from '../youtube-api'

describe('youtube api', () => {
  afterEach(() => {
    apiClient.defaults.adapter = undefined
  })

  it('searches with query, limit and abort signal', async () => {
    const calls: Array<{ url?: string; params?: unknown; signal?: unknown }> = []
    apiClient.defaults.adapter = async (config) => {
      calls.push({ url: config.url, params: config.params, signal: config.signal })
      return {
        data: { items: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }

    const controller = new AbortController()
    await searchYouTube('metal', 10, controller.signal)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/youtube/search')
    expect(calls[0]?.params).toEqual({ q: 'metal', limit: 10 })
    expect(calls[0]?.signal).toBe(controller.signal)
  })

  it('queues a download with the full result payload', async () => {
    const calls: Array<{ url?: string; data?: unknown }> = []
    apiClient.defaults.adapter = async (config) => {
      calls.push({ url: config.url, data: config.data })
      return {
        data: { track: { id: 1 }, queued: true },
        status: 202,
        statusText: 'Accepted',
        headers: {},
        config,
      }
    }

    const response = await queueDownload({
      youtube_id: 'abc123',
      title: 'Song',
      author: 'Artist',
      duration: 201,
      webpage_url: 'https://youtube.com/watch?v=abc123',
      thumbnail_url: null,
    })

    expect(calls[0]?.url).toBe('/youtube/download')
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      youtube_id: 'abc123',
      title: 'Song',
      author: 'Artist',
      duration: 201,
      webpage_url: 'https://youtube.com/watch?v=abc123',
      thumbnail_url: null,
    })
    expect(response.queued).toBe(true)
  })
})
