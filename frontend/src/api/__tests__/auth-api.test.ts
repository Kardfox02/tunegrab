import { afterEach, describe, expect, it } from 'vitest'

import { apiClient } from '../client'
import { changePassword, getCurrentUser, login, logout, register } from '../auth-api'

describe('auth api', () => {
  afterEach(() => {
    apiClient.defaults.adapter = undefined
  })

  it('uses the expected endpoints and payloads', async () => {
    const calls: Array<{ method?: string; url?: string; data?: unknown }> = []
    apiClient.defaults.adapter = async (config) => {
      calls.push({ method: config.method, url: config.url, data: config.data })
      const data = config.url === '/auth/me'
        ? { id: 1, username: 'alice' }
        : config.url === '/auth/logout'
          ? undefined
          : { user: { id: 1, username: 'alice' } }

      return { data, status: config.url === '/auth/register' ? 201 : 200, statusText: 'OK', headers: {}, config }
    }

    await expect(getCurrentUser()).resolves.toEqual({ id: 1, username: 'alice' })
    await login({ username: 'alice', password: 'password' })
    await register({ username: 'alice', password: 'password' })
    await changePassword({ current_password: 'password', new_password: 'new-password' })
    await logout()

    expect(calls).toEqual([
      { method: 'get', url: '/auth/me', data: undefined },
      { method: 'post', url: '/auth/login', data: JSON.stringify({ username: 'alice', password: 'password' }) },
      { method: 'post', url: '/auth/register', data: JSON.stringify({ username: 'alice', password: 'password' }) },
      {
        method: 'post',
        url: '/auth/change-password',
        data: JSON.stringify({ current_password: 'password', new_password: 'new-password' }),
      },
      { method: 'post', url: '/auth/logout', data: undefined },
    ])
  })
})
