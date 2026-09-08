import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/api/client'
import { useAuthStore } from '../auth.store'

function responseError(
  status: number,
  detail: string,
  config?: InternalAxiosRequestConfig,
): AxiosError {
  return new AxiosError(detail, 'ERR_BAD_REQUEST', config, undefined, {
    status,
    statusText: detail,
    headers: {},
    config: config as never,
    data: { detail },
  })
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    apiClient.defaults.adapter = undefined
  })

  it('deduplicates concurrent session restoration', async () => {
    let requestCount = 0
    let resolveRequest: ((value: { id: number; username: string }) => void) | undefined
    const request = new Promise<{ id: number; username: string }>((resolve) => {
      resolveRequest = resolve
    })

    apiClient.defaults.adapter = async (config) => {
      requestCount += 1
      const data = await request
      return { data, status: 200, statusText: 'OK', headers: {}, config }
    }

    const store = useAuthStore()
    const firstRestore = store.restoreSession()
    const secondRestore = store.restoreSession()
    resolveRequest?.({ id: 1, username: 'alice' })

    await Promise.all([firstRestore, secondRestore])

    expect(requestCount).toBe(1)
    expect(store.currentUser).toEqual({ id: 1, username: 'alice' })
    expect(store.initialized).toBe(true)
  })

  it('treats an unauthorized session restore as anonymous', async () => {
    apiClient.defaults.adapter = async (config) => {
      throw responseError(401, 'Authentication required', config)
    }

    const store = useAuthStore()
    await store.restoreSession()

    expect(store.currentUser).toBeNull()
    expect(store.initialized).toBe(true)
    expect(store.lastError).toBeNull()
  })

  it('does not finalize initialization on a transient restore failure and retries', async () => {
    let attempts = 0
    apiClient.defaults.adapter = async (config) => {
      attempts += 1
      if (attempts === 1) {
        throw responseError(500, 'Backend exploded', config)
      }
      return {
        data: { id: 1, username: 'alice' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }

    const store = useAuthStore()
    await expect(store.restoreSession()).rejects.toMatchObject({ status: 500 })

    expect(store.currentUser).toBeNull()
    expect(store.initialized).toBe(false)
    expect(store.lastError).toMatchObject({ status: 500 })

    await store.restoreSession()

    expect(attempts).toBe(2)
    expect(store.currentUser).toEqual({ id: 1, username: 'alice' })
    expect(store.initialized).toBe(true)
    expect(store.lastError).toBeNull()
  })

  it('updates the user after login and change-password', async () => {
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/login') {
        return {
          data: { user: { id: 1, username: 'alice' } },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }

      return {
        data: { user: { id: 1, username: 'alice-renamed' } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }

    const store = useAuthStore()
    await store.login({ username: 'alice', password: 'password' })
    expect(store.currentUser?.username).toBe('alice')

    await store.changePassword({ current_password: 'password', new_password: 'new-password' })
    expect(store.currentUser?.username).toBe('alice-renamed')
  })

  it('clears auth state and registered resources on logout failure', async () => {
    const teardown = vi.fn()
    apiClient.defaults.adapter = async (config) => {
      throw responseError(503, 'Service unavailable', config)
    }

    const store = useAuthStore()
    store.currentUser = { id: 1, username: 'alice' }
    const unregister = store.onSessionTeardown(teardown)

    await expect(store.logout()).rejects.toMatchObject({ status: 503 })

    expect(store.currentUser).toBeNull()
    expect(store.lastError).toMatchObject({ status: 503 })
    expect(teardown).toHaveBeenCalledOnce()
    unregister()
  })

  it('marks the session unauthenticated for protected 401 responses', async () => {
    const teardown = vi.fn()
    apiClient.defaults.adapter = async (config) => {
      throw responseError(401, 'Authentication required', config)
    }

    const store = useAuthStore()
    store.currentUser = { id: 1, username: 'alice' }
    store.onSessionTeardown(teardown)

    await expect(apiClient.get('/tracks')).rejects.toMatchObject({ status: 401 })

    expect(store.currentUser).toBeNull()
    expect(teardown).toHaveBeenCalledOnce()
  })
})
