import axios, { AxiosError } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiClient, createAbortGroup, setUnauthorizedHandler } from '../client'
import { apiErrorFromAxios, isApiError } from '@/types/errors'

describe('apiErrorFromAxios', () => {
  it('normalizes FastAPI validation errors into field messages', () => {
    const error = new AxiosError('Unprocessable Entity', 'ERR_BAD_REQUEST', undefined, undefined, {
      status: 422,
      statusText: 'Unprocessable Entity',
      headers: {},
      config: {} as never,
      data: {
        detail: [
          { type: 'string_too_short', loc: ['body', 'username'], msg: 'String too short' },
          { type: 'missing', loc: ['body', 'password'], msg: 'Field required' },
        ],
      },
    })

    const normalized = apiErrorFromAxios(error)

    expect(normalized.status).toBe(422)
    expect(normalized.detail).toBe('String too short. Field required')
    expect(normalized.fields).toEqual({
      username: 'String too short',
      password: 'Field required',
    })
  })

  it('marks cancelled requests as aborted ApiErrors', () => {
    const source = axios.CancelToken.source()
    source.cancel('stale search')

    const normalized = apiErrorFromAxios(source.token.reason)

    expect(isApiError(normalized)).toBe(true)
    expect(normalized.aborted).toBe(true)
  })
})

describe('apiClient unauthorized handling', () => {
  afterEach(() => {
    setUnauthorizedHandler(null)
    apiClient.defaults.adapter = undefined
  })

  it('does not notify the handler for session-safe 401 endpoints', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
        data: { detail: 'Invalid credentials' },
      })
    }

    await expect(apiClient.post('/auth/login')).rejects.toMatchObject({ status: 401 })
    await expect(apiClient.get('/auth/me')).rejects.toMatchObject({ status: 401 })
    await expect(apiClient.post('/auth/change-password')).rejects.toMatchObject({ status: 401 })

    expect(handler).not.toHaveBeenCalled()
  })

  it('notifies the handler for a protected endpoint', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    apiClient.defaults.adapter = async (config) => {
      throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
        data: { detail: 'Authentication required' },
      })
    }

    await expect(apiClient.get('/tracks')).rejects.toMatchObject({ status: 401 })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ status: 401 }))
  })
})

describe('createAbortGroup', () => {
  it('aborts the previous signal when a newer one is requested', () => {
    const abortGroup = createAbortGroup()
    const firstSignal = abortGroup.nextSignal()
    const secondSignal = abortGroup.nextSignal()

    expect(firstSignal.aborted).toBe(true)
    expect(secondSignal.aborted).toBe(false)

    abortGroup.abort()
    expect(secondSignal.aborted).toBe(true)
  })
})
