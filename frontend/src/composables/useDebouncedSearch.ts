import { computed, onUnmounted, ref, type Ref } from 'vue'

import { createAbortGroup } from '@/api/client'
import { ApiError, isApiError } from '@/types/errors'

export interface UseDebouncedSearchOptions<T> {
  search: (query: string, signal: AbortSignal) => Promise<T[]>
  debounceMs?: number
  minLength?: number
}

export interface UseDebouncedSearchResult<T> {
  query: Ref<string>
  results: Ref<T[]>
  isLoading: Ref<boolean>
  error: Ref<ApiError | null>
  hasSearched: Ref<boolean>
  isQueryTooShort: Ref<boolean>
  schedule: () => void
  submit: () => void
}

export function useDebouncedSearch<T>(
  options: UseDebouncedSearchOptions<T>,
): UseDebouncedSearchResult<T> {
  const debounceMs = options.debounceMs ?? 350
  const minLength = options.minLength ?? 2

  const query = ref('')
  const results = ref<T[]>([]) as Ref<T[]>
  const isLoading = ref(false)
  const error = ref<ApiError | null>(null)
  const hasSearched = ref(false)

  const isQueryTooShort = computed(() => query.value.trim().length < minLength)

  const abortGroup = createAbortGroup()
  let timer: number | null = null

  function clearTimer(): void {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  }

  async function execute(): Promise<void> {
    clearTimer()
    const trimmed = query.value.trim()

    if (trimmed.length < minLength) {
      abortGroup.abort()
      isLoading.value = false
      error.value = null
      hasSearched.value = false
      results.value = []
      return
    }

    const signal = abortGroup.nextSignal()
    isLoading.value = true
    error.value = null
    hasSearched.value = true

    try {
      const items = await options.search(trimmed, signal)
      if (signal.aborted) {
        return
      }
      results.value = items
    } catch (cause: unknown) {
      if (signal.aborted || (isApiError(cause) && cause.aborted)) {
        return
      }
      error.value = isApiError(cause) ? cause : new ApiError({ cause })
      results.value = []
    } finally {
      if (!signal.aborted) {
        isLoading.value = false
      }
    }
  }

  function schedule(): void {
    clearTimer()
    timer = window.setTimeout(() => {
      timer = null
      void execute()
    }, debounceMs)
  }

  function submit(): void {
    void execute()
  }

  onUnmounted(() => {
    clearTimer()
    abortGroup.abort()
  })

  return {
    query,
    results,
    isLoading,
    error,
    hasSearched,
    isQueryTooShort,
    schedule,
    submit,
  }
}
