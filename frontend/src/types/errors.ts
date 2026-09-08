import axios from 'axios'

export interface ValidationErrorItem {
  type: string
  loc: Array<string | number>
  msg: string
  input?: unknown
}

export interface ApiErrorOptions {
  status?: number
  detail?: string
  fields?: Record<string, string>
  aborted?: boolean
  cause?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly detail: string
  readonly fields: Record<string, string>
  readonly aborted: boolean

  constructor(options: ApiErrorOptions = {}) {
    const detail = options.detail ?? 'Произошла ошибка при выполнении запроса'
    super(detail, { cause: options.cause })
    this.name = 'ApiError'
    this.status = options.status ?? 0
    this.detail = detail
    this.fields = options.fields ?? {}
    this.aborted = options.aborted ?? false
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

export function isValidationErrorDetail(value: unknown): value is ValidationErrorItem[] {
  return Array.isArray(value) && value.every(isValidationErrorItem)
}

function isValidationErrorItem(value: unknown): value is ValidationErrorItem {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const item = value as Partial<ValidationErrorItem>
  return typeof item.type === 'string'
    && Array.isArray(item.loc)
    && item.loc.every((part) => typeof part === 'string' || typeof part === 'number')
    && typeof item.msg === 'string'
}

export function apiErrorFromAxios(error: unknown): ApiError {
  if (axios.isCancel(error)) {
    return new ApiError({
      detail: 'Запрос отменен',
      aborted: true,
      cause: error,
    })
  }

  if (!axios.isAxiosError(error)) {
    return new ApiError({ cause: error })
  }

  const status = error.response?.status ?? 0
  const responseDetail = error.response?.data?.detail

  if (isValidationErrorDetail(responseDetail)) {
    const fields = Object.fromEntries(
      responseDetail
        .filter((item) => item.loc.length > 0)
        .map((item) => [String(item.loc[item.loc.length - 1]), item.msg]),
    )
    return new ApiError({
      status,
      detail: responseDetail.map((item) => item.msg).join('. '),
      fields,
      cause: error,
    })
  }

  const detail = typeof responseDetail === 'string'
    ? responseDetail
    : error.message || 'Не удалось выполнить запрос'

  return new ApiError({ status, detail, cause: error })
}
