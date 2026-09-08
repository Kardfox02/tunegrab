import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { addLike, fetchLikes, removeLike } from '@/api/likes-api'
import { fetchListeningStats } from '@/api/events-api'
import { useAuthStore } from '@/stores/auth.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { isApiError } from '@/types/errors'
import type { ListeningStats } from '@/types/events'
import type { Track } from '@/types/track'

// Партия догрузки «Любимого» — та же, что в библиотеке.
const LIKES_PAGE_LIMIT = 50

export const useProfileStore = defineStore('profile', () => {
  const auth = useAuthStore()
  const notifications = useNotificationsStore()

  const stats = ref<ListeningStats | null>(null)
  const likedTracks = ref<Track[]>([])
  const likedTrackIds = ref<Set<number>>(new Set())
  const togglingIds = ref<Set<number>>(new Set())
  const isLoading = ref(false)
  const isLoaded = ref(false)
  const isStatsLoading = ref(false)
  const statsError = ref<string | null>(null)
  const likesError = ref<string | null>(null)

  // Серверная пагинация «Любимого»: курсор offset — единственный источник
  // истины о позиции, как в library.store.
  const likesTotal = ref(0)
  const likesCursor = ref(0)
  const isLoadingLikes = ref(false)
  const isLoadingLikesNextPage = ref(false)
  const likesNextPagePromise: { current: Promise<void> | null } = { current: null }

  const hasLikes = computed(() => likedTracks.value.length > 0)
  const hasMoreLikes = computed(() => likesCursor.value < likesTotal.value)

  function applyLikes(tracks: Track[], total: number): void {
    likedTracks.value = tracks
    likedTrackIds.value = new Set(tracks.map((track) => track.id))
    likesTotal.value = total
    likesCursor.value = tracks.length
  }

  // Профиль нужен сердечкам в библиотеке и кабинету: грузится лениво один раз
  // за сессию, после logout сбрасывается teardown'ом.
  async function loadProfile(force = false): Promise<void> {
    if (isLoaded.value && !force) {
      return
    }

    isLoading.value = true
    isStatsLoading.value = true
    isLoadingLikes.value = true
    statsError.value = null
    likesError.value = null

    const [statsResult, likesResult] = await Promise.allSettled([
      fetchListeningStats(),
      fetchLikes({ limit: LIKES_PAGE_LIMIT, offset: 0 }),
    ])

    if (statsResult.status === 'fulfilled' && statsResult.value && typeof statsResult.value === 'object' && 'play_count' in statsResult.value) {
      stats.value = statsResult.value
    } else {
      statsError.value = 'Не удалось загрузить статистику'
    }

    if (likesResult.status === 'fulfilled' && Array.isArray(likesResult.value?.items)) {
      applyLikes(likesResult.value.items.map((item) => item.track), likesResult.value.total)
    } else {
      likesError.value = 'Не удалось загрузить любимые треки'
    }

    isLoading.value = false
    isStatsLoading.value = false
    isLoadingLikes.value = false
    isLoaded.value = true
  }

  // Каждый вход в кабинет — свежие данные: сбрасываем состояние (секции
  // покажут спиннеры) и грузим stats + likes заново.
  async function reloadProfile(): Promise<void> {
    stats.value = null
    applyLikes([], 0)
    isLoaded.value = false
    await loadProfile()
  }

  async function loadNextLikes(): Promise<void> {
    if (!hasMoreLikes.value || isLoadingLikesNextPage.value) {
      return
    }

    // Дедупликация параллельных вызовов (сентинел + scroll) — один Promise.
    if (likesNextPagePromise.current) {
      return likesNextPagePromise.current
    }

    const request = (async () => {
      isLoadingLikesNextPage.value = true
      try {
        const response = await fetchLikes({
          limit: LIKES_PAGE_LIMIT,
          offset: likesCursor.value,
        })
        if (!Array.isArray(response?.items)) {
          throw new Error('Malformed likes response')
        }

        // Offset-пагинация + оптимистичные удаления дают дубли — фильтруем.
        const knownIds = new Set(likedTracks.value.map((track) => track.id))
        const fresh = response.items
          .map((item) => item.track)
          .filter((track) => !knownIds.has(track.id))
        likedTracks.value = [...likedTracks.value, ...fresh]
        likedTrackIds.value = new Set(likedTracks.value.map((track) => track.id))
        likesCursor.value += response.items.length
        likesTotal.value = response.total
        likesError.value = null
      } catch {
        likesError.value = 'Не удалось загрузить любимые треки'
      } finally {
        isLoadingLikesNextPage.value = false
        likesNextPagePromise.current = null
      }
    })()

    likesNextPagePromise.current = request
    return request
  }

  async function refreshLikes(): Promise<void> {
    try {
      const response = await fetchLikes({ limit: LIKES_PAGE_LIMIT, offset: 0 })
      if (!Array.isArray(response?.items)) {
        throw new Error('Malformed likes response')
      }
      applyLikes(response.items.map((item) => item.track), response.total)
      likesError.value = null
    } catch {
      likesError.value = 'Не удалось загрузить любимые треки'
    }
  }

  async function refreshStats(periodDays?: number): Promise<void> {
    isStatsLoading.value = true
    statsError.value = null
    try {
      const fetched = await fetchListeningStats(periodDays)
      if (!fetched || typeof fetched !== 'object' || !('play_count' in fetched)) {
        throw new Error('Malformed stats response')
      }
      stats.value = fetched
    } catch {
      statsError.value = 'Не удалось загрузить статистику'
    } finally {
      isStatsLoading.value = false
    }
  }

  // Оптимистичный toggle: UI реагирует мгновенно, при ошибке — откат и тост.
  async function toggleLike(track: Track): Promise<void> {
    if (togglingIds.value.has(track.id)) {
      return
    }

    const wasLiked = likedTrackIds.value.has(track.id)
    const nextIds = new Set(likedTrackIds.value)
    if (wasLiked) {
      nextIds.delete(track.id)
      likedTracks.value = likedTracks.value.filter((item) => item.id !== track.id)
      likesTotal.value = Math.max(0, likesTotal.value - 1)
    } else {
      nextIds.add(track.id)
      likedTracks.value = [track, ...likedTracks.value]
      likesTotal.value += 1
    }
    likedTrackIds.value = nextIds
    togglingIds.value = new Set([...togglingIds.value, track.id])

    try {
      if (wasLiked) {
        await removeLike(track.id)
      } else {
        await addLike(track.id)
      }
    } catch (error: unknown) {
      // Откат оптимистичного состояния.
      const restoredIds = new Set(likedTrackIds.value)
      if (wasLiked) {
        restoredIds.add(track.id)
        likedTracks.value = [track, ...likedTracks.value]
        likesTotal.value += 1
      } else {
        restoredIds.delete(track.id)
        likedTracks.value = likedTracks.value.filter((item) => item.id !== track.id)
        likesTotal.value = Math.max(0, likesTotal.value - 1)
      }
      likedTrackIds.value = restoredIds

      const detail = isApiError(error) ? error.detail : null
      notifications.push(
        detail ?? 'Не удалось обновить любимые треки',
        'error',
      )
    } finally {
      const nextToggling = new Set(togglingIds.value)
      nextToggling.delete(track.id)
      togglingIds.value = nextToggling
    }
  }

  auth.onSessionTeardown(() => {
    stats.value = null
    applyLikes([], 0)
    togglingIds.value = new Set()
    isLoading.value = false
    isLoaded.value = false
    isStatsLoading.value = false
    isLoadingLikes.value = false
    isLoadingLikesNextPage.value = false
    statsError.value = null
    likesError.value = null
  })

  return {
    stats,
    likedTracks,
    likedTrackIds,
    togglingIds,
    isLoading,
    isLoaded,
    isStatsLoading,
    statsError,
    likesError,
    hasLikes,
    likesTotal,
    likesCursor,
    hasMoreLikes,
    isLoadingLikes,
    isLoadingLikesNextPage,
    loadProfile,
    reloadProfile,
    loadNextLikes,
    refreshLikes,
    refreshStats,
    toggleLike,
  }
})
