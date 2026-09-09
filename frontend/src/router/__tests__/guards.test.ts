import { AxiosError } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { flushPromises } from '@vue/test-utils'

import { apiClient } from '@/api/client'
import { createAppRouter } from '../index'

function unauthorizedError(config: object): AxiosError {
  return new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config as never, undefined, {
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config: config as never,
    data: { detail: 'Authentication required' },
  })
}

describe('router guards', () => {
  afterEach(() => {
    apiClient.defaults.adapter = undefined
  })

  it('redirects anonymous users to login and preserves the target', async () => {
    apiClient.defaults.adapter = async (config) => {
      throw unauthorizedError(config)
    }

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(pinia, createMemoryHistory())

    await router.push('/search?q=ambient')

    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/search?q=ambient')
  })

  it('redirects authenticated users away from guest routes', async () => {
    apiClient.defaults.adapter = async (config) => ({
      data: { id: 1, username: 'alice' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(pinia, createMemoryHistory())

    await router.push('/login')

    expect(router.currentRoute.value.name).toBe('library')
  })

  it('shares one session restore request across navigations', async () => {
    let restoreCount = 0
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        restoreCount += 1
        return {
          data: { id: 1, username: 'alice' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      if (config.url === '/youtube/downloads/active') {
        return {
          data: { items: [] },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      if (config.url === '/tracks') {
        return {
          data: { items: [], total: 0, limit: 50, offset: 0 },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    }

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(pinia, createMemoryHistory())

    await router.push('/library')
    await router.push('/profile')

    expect(restoreCount).toBe(1)
  })

  it('redirects protected routes to login when restore fails transiently', async () => {
    let attempts = 0
    apiClient.defaults.adapter = async (config) => {
      if (config.url === '/auth/me') {
        attempts += 1
        throw new AxiosError('Network Error', 'ERR_NETWORK', config, undefined, {
          status: 500,
          statusText: 'Internal Server Error',
          headers: {},
          config,
          data: { detail: 'Backend exploded' },
        })
      }
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config }
    }

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(pinia, createMemoryHistory())

    await router.push('/library')

    // Первая попытка — для /library, вторая — для редиректа на /login.
    expect(attempts).toBe(2)
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.redirect).toBe('/library')

    // Backend поднялся — повторная навигация успешно восстанавливает сессию.
    apiClient.defaults.adapter = async (config) => ({
      data: config.url === '/auth/me' ? { id: 1, username: 'alice' } : {},
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
    await router.push('/library')

    expect(router.currentRoute.value.name).toBe('library')
  })

  it('redirects to login after a protected request loses authentication', async () => {
    let meRequest = true
    apiClient.defaults.adapter = async (config) => {
      if (meRequest) {
        return {
          data: { id: 1, username: 'alice' },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }

      throw unauthorizedError(config)
    }

    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(pinia, createMemoryHistory())
    await router.push('/library')

    meRequest = false
    await apiClient.get('/tracks').catch(() => undefined)
    await flushPromises()
    await router.isReady()

    expect(router.currentRoute.value.name).toBe('login')
  })
})
