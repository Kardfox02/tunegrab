import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { addLike, fetchLikedTrackIds, fetchLikes, removeLike } from '@/api/likes-api'
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

  // Epoch сессии данных: инкремент при teardown (logout) и при reloadProfile.
  // Async-операции захватывают значение до await и проверяют после — ответ,
  // пришедший после сброса, не пишет в состояние (гонка с logout/перезагрузкой).
  let dataEpoch = 0

  const hasLikes = computed(() => likedTracks.value.length > 0)
  const hasMoreLikes = computed(() => likesCursor.value < likesTotal.value)

  // ── Полный сбор «Любимого» (для «Перемешать и играть») ─────────────────
  const LIKES_COLLECT_LIMIT = 100 // серверный cap схемы likes
  const isCollectingLikes = ref(false)

  /**
   * Догружает все лайки за один вызов (страницы по 100 параллельными
   * волнами). Порядок результата неважен — коллекция для перемешивания.
   */
  async function collectAllLikes(): Promise<Track[]> {
    if (isCollectingLikes.value) {
      return []
    }

    isCollectingLikes.value = true
    try {
      const first = await fetchLikes({ limit: LIKES_COLLECT_LIMIT, offset: 0 })
      const collected: Track[] = first.items.map((entry) => entry.track)
      const totalCount = first.total

      const offsets: number[] = []
      for (let offset = LIKES_COLLECT_LIMIT; offset < totalCount; offset += LIKES_COLLECT_LIMIT) {
        offsets.push(offset)
      }

      const WAVE = 6
      for (let start = 0; start < offsets.length; start += WAVE) {
        const wave = offsets
          .slice(start, start + WAVE)
          .map((offset) => fetchLikes({ limit: LIKES_COLLECT_LIMIT, offset }))
        const responses = await Promise.all(wave)
        for (const response of responses) {
          collected.push(...response.items.map((entry) => entry.track))
        }
      }

      // Дедупликация: оптимистичные лайки/анлайки во время сбора могут дать
      // дубль между страницами.
      const seen = new Set<number>()
      const unique: Track[] = []
      for (const track of collected) {
        if (!seen.has(track.id)) {
          seen.add(track.id)
          unique.push(track)
        }
      }
      return unique
    } finally {
      isCollectingLikes.value = false
    }
  }

  // Полный набор лайкнутых id (все страницы) — источник для сердечек.
  // Живёт независимо от постраничного списка likedTracks: список «Любимого»
  // догружается лениво, а сердечки должны быть готовы сразу во всей библиотеке.
  function setLikedTrackIds(trackIds: number[]): void {
    likedTrackIds.value = new Set(trackIds)
  }

  // Сброс/замена постраничного списка «Любимого» (без правки набора сердечек).
  function applyLikedTracks(tracks: Track[], total: number): void {
    likedTracks.value = tracks
    likesTotal.value = total
    likesCursor.value = tracks.length
  }

  // Профиль нужен сердечкам в библиотеке и кабинету: грузится лениво один раз
  // за сессию, после logout сбрасывается teardown'ом.
  async function loadProfile(force = false): Promise<void> {
    if (isLoaded.value && !force) {
      return
    }

    const epochAtStart = dataEpoch
    isLoading.value = true
    isStatsLoading.value = true
    isLoadingLikes.value = true
    statsError.value = null
    likesError.value = null

    const [statsResult, idsResult, likesResult] = await Promise.allSettled([
      fetchListeningStats(),
      fetchLikedTrackIds(),
      fetchLikes({ limit: LIKES_PAGE_LIMIT, offset: 0 }),
    ])

    // Logout (или reloadProfile) во время запроса: сброшенное состояние не
    // заполняется данными чужой сессии; isLoaded остаётся false, следующий
    // вход перезагрузит данные заново.
    if (epochAtStart !== dataEpoch) {
      return
    }

    // Форма статистики гарантируется assertShape в events-api.
    if (statsResult.status === 'fulfilled' && statsResult.value) {
      stats.value = statsResult.value
    } else {
      statsError.value = 'Не удалось загрузить статистику'
    }

    if (idsResult.status === 'fulfilled' && Array.isArray(idsResult.value)) {
      setLikedTrackIds(idsResult.value)
    } else {
      likesError.value = 'Не удалось загрузить любимые треки'
    }

    if (likesResult.status === 'fulfilled' && Array.isArray(likesResult.value?.items)) {
      applyLikedTracks(likesResult.value.items.map((item) => item.track), likesResult.value.total)
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
    // Инкремент epoch «аннулирует» все in-flight запросы предыдущего прохода
    // (в том числе незавершённый loadNextLikes): их ответы будут отброшены.
    dataEpoch += 1
    stats.value = null
    applyLikedTracks([], 0)
    setLikedTrackIds([])
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

    const epochAtStart = dataEpoch
    let request: Promise<void> = Promise.resolve()
    request = (async () => {
      isLoadingLikesNextPage.value = true
      try {
        const response = await fetchLikes({
          limit: LIKES_PAGE_LIMIT,
          offset: likesCursor.value,
        })
        if (!Array.isArray(response?.items)) {
          throw new Error('Malformed likes response')
        }

        // Teardown/reload во время запроса — ответ устарел.
        if (epochAtStart !== dataEpoch) {
          return
        }

        // Offset-пагинация + оптимистичные удаления дают дубли — фильтруем.
        const knownIds = new Set(likedTracks.value.map((track) => track.id))
        const fresh = response.items
          .map((item) => item.track)
          .filter((track) => !knownIds.has(track.id))
        likedTracks.value = [...likedTracks.value, ...fresh]
        likesCursor.value += response.items.length
        likesTotal.value = response.total
        likesError.value = null
      } catch {
        // Ошибка в прошлом проходе после сброса состояния не актуальна.
        if (epochAtStart === dataEpoch) {
          likesError.value = 'Не удалось загрузить любимые треки'
        }
      } finally {
        if (epochAtStart === dataEpoch) {
          isLoadingLikesNextPage.value = false
        }
        if (likesNextPagePromise.current === request) {
          likesNextPagePromise.current = null
        }
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
      applyLikedTracks(response.items.map((item) => item.track), response.total)
      likesError.value = null
    } catch {
      likesError.value = 'Не удалось загрузить любимые треки'
    }
  }

  // Гонка периодов: клик «30 дней» + поллинг «7 дней» — чей ответ пришёл
  // последним, тот и победил, независимо от выбранного периода. Request-id
  // обеспечивает запись только последнего запроса.
  let statsRequestId = 0
  async function refreshStats(periodDays?: number): Promise<void> {
    const requestId = ++statsRequestId
    isStatsLoading.value = true
    statsError.value = null
    try {
      const fetched = await fetchListeningStats(periodDays)
      if (requestId !== statsRequestId) {
        // Пришёл более старый запрос — newer запрос уже перезаписал stats.
        return
      }
      stats.value = fetched
    } catch {
      if (requestId === statsRequestId) {
        statsError.value = 'Не удалось загрузить статистику'
      }
    } finally {
      if (requestId === statsRequestId) {
        isStatsLoading.value = false
      }
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
    // Инкремент epoch отбрасывает ответы всех in-flight запросов сессии:
    // late-response не должен писать в состояние нового пользователя.
    dataEpoch += 1
    statsRequestId += 1
    stats.value = null
    applyLikedTracks([], 0)
    setLikedTrackIds([])
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
    isCollectingLikes,
    collectAllLikes,
    loadProfile,
    reloadProfile,
    loadNextLikes,
    refreshLikes,
    refreshStats,
    toggleLike,
  }
})
