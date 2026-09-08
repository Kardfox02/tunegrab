import axios, { type AxiosError, type AxiosInstance } from 'axios'

import { apiErrorFromAxios, type ApiError } from '@/types/errors'

export type UnauthorizedHandler = (error: ApiError) => void

const apiClient: AxiosInstance = axios.create({
  baseURL: '',
  withCredentials: true,
})

let unauthorizedHandler: UnauthorizedHandler | null = null

const sessionSafe401Paths = ['/auth/me', '/auth/login', '/auth/change-password']

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
}

function getRequestPath(error: AxiosError): string {
  const url = error.config?.url ?? ''

  try {
    return new URL(url, window.location.origin).pathname
  } catch {
    return url.split('?')[0] ?? ''
  }
}

function shouldHandleUnauthorized(error: AxiosError, apiError: ApiError): boolean {
  return apiError.status === 401
    && !sessionSafe401Paths.includes(getRequestPath(error))
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const normalizedError = apiErrorFromAxios(error)

    if (axios.isAxiosError(error) && shouldHandleUnauthorized(error, normalizedError)) {
      unauthorizedHandler?.(normalizedError)
    }

    return Promise.reject(normalizedError)
  },
)

export interface AbortGroup {
  nextSignal(): AbortSignal
  abort(): void
}

export function createAbortGroup(): AbortGroup {
  let controller: AbortController | null = null

  return {
    nextSignal(): AbortSignal {
      controller?.abort()
      controller = new AbortController()
      return controller.signal
    },
    abort(): void {
      controller?.abort()
      controller = null
    },
  }
}

export { apiClient }
