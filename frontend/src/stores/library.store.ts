import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LocationQuery } from 'vue-router'

import { createAbortGroup } from '@/api/client'
import { deleteTrack as deleteTrackRequest, listTracks } from '@/api/tracks-api'
import { useAuthStore } from '@/stores/auth.store'
import { usePlayerStore } from '@/stores/player.store'
import { ApiError, isApiError } from '@/types/errors'
import type { Track, TrackListQuery, TrackSortField, TrackSortOrder } from '@/types/track'

export const LIBRARY_PAGE_LIMIT = 50

const SORT_FIELDS: readonly TrackSortField[] = [
  'created_at',
  'title',
  'author',
  'duration',
  'file_size',
  'progress',
  'status',
]

function readSortField(value: unknown): TrackSortField {
  return typeof value === 'string' && SORT_FIELDS.includes(value as TrackSortField)
    ? (value as TrackSortField)
    : 'created_at'
}

function readSortOrder(value: unknown): TrackSortOrder {
  return value === 'asc' ? 'asc' : 'desc'
}

function readQuery(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export const useLibraryStore = defineStore('library', () => {
  const auth = useAuthStore()
  const player = usePlayerStore()

  const tracks = ref<Track[]>([])
  const total = ref(0)
  const page = ref(1)
  const query = ref('')
  const sortBy = ref<TrackSortField>('created_at')
  const order = ref<TrackSortOrder>('desc')
  const isLoading = ref(false)
  const isLoadingNextPage = ref(false)
  const error = ref<ApiError | null>(null)
  const isInitialized = ref(false)
  const deletingIds = ref<number[]>([])
  const deleteError = ref<{ id: number; message: string } | null>(null)

  const isQueryEmpty = computed(() => query.value.trim().length === 0)
  // Курсор — источник истины о позиции в серверном списке: при дедупликации
  // дублей tracks.length может навсегда отстать от total.
  const hasMore = computed(() => nextPageCursor.value !== null && nextPageCursor.value < total.value)

  const abortGroup = createAbortGroup()
  const extensionAbortGroup = createAbortGroup()
  const nextPageCursor = ref<number | null>(null)
  let nextPagePromise: Promise<Track[]> | null = null

  async function load(): Promise<void> {
    // Обычная загрузка (навигация, поиск, сортировка) отменяет незавершённый
    // prefetch, чтобы его ответ не дописал устаревшие треки в новый список.
    extensionAbortGroup.abort()
    nextPageCursor.value = null
    nextPagePromise = null
    isLoadingNextPage.value = false

    const signal = abortGroup.nextSignal()
    isLoading.value = true
    error.value = null

    try {
      const params: TrackListQuery = {
        q: query.value.trim() || undefined,
        sort_by: sortBy.value,
        order: order.value,
        limit: LIBRARY_PAGE_LIMIT,
        offset: 0,
      }
      const response = await listTracks(params, signal)
      if (signal.aborted) {
        return
      }
      tracks.value = response.items
      total.value = response.total
      page.value = 1
      nextPageCursor.value = response.items.length
      isInitialized.value = true
    } catch (cause: unknown) {
      if (signal.aborted || (isApiError(cause) && cause.aborted)) {
        return
      }
      error.value = isApiError(cause) ? cause : new ApiError({ cause })
      tracks.value = []
      total.value = 0
    } finally {
      if (!signal.aborted) {
        isLoading.value = false
      }
    }
  }

  function applyRouteQuery(routeQuery: LocationQuery): void {
    // `page` больше не является частью URL-контракта: список бесконечный.
    const nextQuery = readQuery(routeQuery.q).trim()
    const nextSortBy = readSortField(routeQuery.sort_by)
    const nextOrder = readSortOrder(routeQuery.order)

    const changed =
      nextQuery !== query.value.trim() ||
      nextSortBy !== sortBy.value ||
      nextOrder !== order.value

    query.value = nextQuery
    sortBy.value = nextSortBy
    order.value = nextOrder

    if (changed || !isInitialized.value) {
      void load()
    }
  }

  async function removeTrack(trackId: number): Promise<void> {
    if (deletingIds.value.includes(trackId)) {
      return
    }

    deleteError.value = null
    deletingIds.value = [...deletingIds.value, trackId]

    try {
      await deleteTrackRequest(trackId)
      player.removeTrack(trackId)
      // Бесконечный список не перезагружается целиком: трек убирается локально,
      // иначе список откатился бы к первой странице.
      tracks.value = tracks.value.filter((track) => track.id !== trackId)
      total.value = Math.max(0, total.value - 1)
    } catch (cause: unknown) {
      deleteError.value = {
        id: trackId,
        message: isApiError(cause)
          ? cause.status === 409
            ? 'Файл используется плеером — остановите воспроизведение и попробуйте еще раз'
            : cause.detail
          : 'Не удалось удалить трек',
      }
    } finally {
      deletingIds.value = deletingIds.value.filter((id) => id !== trackId)
    }
  }

  async function loadNextPage(): Promise<Track[]> {
    if (nextPageCursor.value === null || !hasMore.value) {
      return []
    }

    if (nextPagePromise) {
      return nextPagePromise
    }

    const request = (async () => {
      const cursor = nextPageCursor.value ?? 0
      const signal = extensionAbortGroup.nextSignal()
      isLoadingNextPage.value = true

      try {
        const response = await listTracks(
          {
            q: query.value.trim() || undefined,
            sort_by: sortBy.value,
            order: order.value,
            limit: LIBRARY_PAGE_LIMIT,
            offset: cursor,
          },
          signal,
        )
        if (signal.aborted) {
          return []
        }

        // Offset-пагинация + удаление = в партии могут приехать дубли уже
        // показанных id; в список попадают только новые треки.
        const knownIds = new Set(tracks.value.map((track) => track.id))
        const fresh = response.items.filter((track) => !knownIds.has(track.id))
        tracks.value = [...tracks.value, ...fresh]
        total.value = response.total
        page.value += 1
        nextPageCursor.value = cursor + response.items.length
        return fresh
      } catch (cause: unknown) {
        if (signal.aborted || (isApiError(cause) && cause.aborted)) {
          return []
        }
        return [] as Track[]
      } finally {
        if (!signal.aborted) {
          isLoadingNextPage.value = false
        }
      }
    })()

    nextPagePromise = request
    try {
      return await request
    } finally {
      nextPagePromise = null
    }
  }

  function reset(): void {
    abortGroup.abort()
    extensionAbortGroup.abort()
    nextPageCursor.value = null
    tracks.value = []
    total.value = 0
    page.value = 1
    query.value = ''
    sortBy.value = 'created_at'
    order.value = 'desc'
    isLoading.value = false
    isLoadingNextPage.value = false
    error.value = null
    isInitialized.value = false
    deletingIds.value = []
    deleteError.value = null
  }

  auth.onSessionTeardown(() => reset())

  return {
    tracks,
    total,
    page,
    query,
    sortBy,
    order,
    isLoading,
    isLoadingNextPage,
    error,
    isInitialized,
    deletingIds,
    deleteError,
    hasMore,
    isQueryEmpty,
    load,
    applyRouteQuery,
    loadNextPage,
    removeTrack,
    reset,
  }
})
