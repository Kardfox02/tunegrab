import axios, { type AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'

import { apiErrorFromAxios, type ApiError } from '@/types/errors'

export type UnauthorizedHandler = (error: ApiError) => void

const apiClient: AxiosInstance = axios.create({
  baseURL: '',
  withCredentials: true,
})

let unauthorizedHandler: UnauthorizedHandler | null = null

const sessionSafe401Paths = ['/auth/me', '/auth/login', '/auth/change-password']

// Волна параллельных 401 (десяток запросов при заходе на страницу) раньше
// дергала unauthorizedHandler N раз подряд — N teardown'ов и редиректов.
// Дедупим: после первого срабатывания следующие 401 глушатся до сброса флага.
let isUnauthorizedHandled = false

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler
  // Свежий handler — новое состояние дедупа (важно для тестов и re-init).
  isUnauthorizedHandled = false
}

// Публичные эндпоинты: успешный ответ на них не доказывает живость сессии,
// поэтому посреди волны 401 не должен снимать щит дедупа.
const publicSuccessPrefixes = ['/covers/', '/playlists/shared/', '/auth/', '/health']

// Успешный ответ на защищённом домене восстанавливает чувствительность к 401:
// сессия снова жива, и следующий внезапный 401 должен обрабатываться.
function notifyRequestSuccess(url: string | undefined): void {
  const path = resolvePath(url)
  if (publicSuccessPrefixes.some((prefix) => path.startsWith(prefix))) {
    return
  }
  isUnauthorizedHandled = false
}

function resolvePath(url: string | undefined): string {
  const source = url ?? ''
  try {
    return new URL(source, window.location.origin).pathname
  } catch {
    return source.split('?')[0] ?? ''
  }
}

function getRequestPath(error: AxiosError): string {
  return resolvePath(error.config?.url ?? '')
}

function shouldHandleUnauthorized(error: AxiosError, apiError: ApiError): boolean {
  return apiError.status === 401
    && !sessionSafe401Paths.includes(getRequestPath(error))
}

apiClient.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => {
    notifyRequestSuccess(response.config?.url)
    return response
  },
  (error: unknown) => {
    // CanceledError наследует AxiosError (axios v1): без раннего выхода отмена
    // проходила бы весь 401-пайплайн и могла дернуть unauthorizedHandler.
    if (axios.isCancel(error)) {
      return Promise.reject(apiErrorFromAxios(error))
    }

    const normalizedError = apiErrorFromAxios(error)

    if (
      axios.isAxiosError(error)
      && shouldHandleUnauthorized(error, normalizedError)
      && !isUnauthorizedHandled
    ) {
      isUnauthorizedHandled = true
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

// ── Валидаторы формы тела ответа (для assertShape) ────────────────────────

export function isApiObject(body: unknown): body is Record<string, unknown> {
  return typeof body === 'object' && body !== null
}

export function hasArray(body: unknown, prop: string): boolean {
  return isApiObject(body) && Array.isArray(body[prop])
}

export function hasString(body: unknown, prop: string): boolean {
  return isApiObject(body) && typeof body[prop] === 'string'
}

export function hasNumber(body: unknown, prop: string): boolean {
  return isApiObject(body) && typeof body[prop] === 'number'
}

/**
 * Единая точка HTTP-запросов доменных модулей: делает запрос и проверяет
 * форму тела (soft validation — мусорный ответ превращается в понятную
 * ошибку, а не в NaN/undefined глубоко в UI). `assertShape` не передан —
 * тело возвращается как есть.
 */
export async function request<T>(
  config: {
    url: string
    method?: 'get' | 'post' | 'put' | 'patch' | 'delete'
    data?: unknown
    params?: Record<string, unknown>
    signal?: AbortSignal
    assertShape?: (body: unknown) => boolean
    malformedMessage?: string
  },
): Promise<T> {
  const method = config.method ?? 'get'
  const response = await apiClient.request<T>({
    url: config.url,
    method,
    data: config.data,
    params: config.params,
    signal: config.signal,
  })

  if (config.assertShape && !config.assertShape(response.data)) {
    throw new Error(config.malformedMessage ?? 'Malformed response')
  }

  return response.data
}

export { apiClient }
