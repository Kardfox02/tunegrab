import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

import {
  cancelDownload as cancelDownloadRequest,
  fetchActiveDownloads,
  fetchDownloadStatus,
  queueDownload as queueDownloadRequest,
  retryDownload as retryDownloadRequest,
} from '@/api/youtube-api'
import { createAbortGroup, type AbortGroup } from '@/api/client'
import { createPolling, type PollingController } from '@/composables/usePolling'
import { useAuthStore } from '@/stores/auth.store'
import { useLibraryStore } from '@/stores/library.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { isApiError } from '@/types/errors'
import { ACTIVE_TRACK_STATUSES } from '@/types/track'
import type { Track, TrackStatus } from '@/types/track'
import type { YouTubeSearchResult } from '@/types/youtube'

export type DownloadUiState = 'idle' | 'queued' | 'exists'

// Поллер глохнет после N подряд неудачных запросов статуса: сеть/5xx обычно
// восстанавливаются быстрее, а «мертвый» трек (404/403) иначе крутил бы
// бессрочный интервал до самого logout.
const POLLING_FAILURE_BUDGET = 5

const activeStatuses: ReadonlySet<TrackStatus> = new Set(ACTIVE_TRACK_STATUSES)

function isActiveStatus(status: TrackStatus): boolean {
  return activeStatuses.has(status)
}

export const useDownloadsStore = defineStore('downloads', () => {
  const auth = useAuthStore()

  const active = ref<Track[]>([])
  const isRestored = ref(false)

  const youtubeLinks = reactive(new Map<string, { trackId: number; exists: boolean }>())
  const generations = new Map<number, number>()
  const pollers = new Map<number, { controller: PollingController; abortGroup: AbortGroup }>()
  let epoch = 0
  // In-flight мемоизация restore() (паттерн auth.restoreSession) — вместо
  // булева флага: параллельные вызовы делят один Promise.
  let restorePromise: Promise<void> | null = null

  const activeById = computed(() => {
    const map = new Map<number, Track>()
    for (const track of active.value) {
      map.set(track.id, track)
    }
    return map
  })

  function bumpGeneration(trackId: number): void {
    generations.set(trackId, (generations.get(trackId) ?? 0) + 1)
  }

  function upsertActive(track: Track): void {
    const wasActive = active.value.some((item) => item.id === track.id)

    if (isActiveStatus(track.status)) {
      if (!wasActive) {
        active.value = [...active.value, track]
      } else {
        active.value = active.value.map((item) => (item.id === track.id ? track : item))
      }
      return
    }

    if (wasActive) {
      active.value = active.value.filter((item) => item.id !== track.id)
      if (track.status === 'done') {
        const library = useLibraryStore()
        void library.load()
        useNotificationsStore().push(`Загрузка завершена: ${track.title}`, 'success')
      }
      if (track.status === 'error') {
        useNotificationsStore().push(`Не удалось загрузить: ${track.title}`, 'warning')
      }
    }
  }

  function applyTrack(track: Track): void {
    upsertActive(track)

    for (const [youtubeId, link] of youtubeLinks) {
      if (link.trackId !== track.id) {
        continue
      }
      if (track.status === 'done') {
        youtubeLinks.set(youtubeId, { trackId: link.trackId, exists: true })
      } else if (track.status === 'error' || track.status === 'cancelled') {
        youtubeLinks.delete(youtubeId)
      }
    }
  }

  function startPolling(trackId: number): void {
    if (pollers.has(trackId)) {
      return
    }

    bumpGeneration(trackId)
    const generation = generations.get(trackId)
    const abortGroup = createAbortGroup()
    let consecutiveFailures = 0

    const controller = createPolling(async () => {
      try {
        const track = await fetchDownloadStatus(trackId, abortGroup.nextSignal())
        if (generation === undefined || generations.get(trackId) !== generation) {
          return
        }
        consecutiveFailures = 0
        applyTrack(track)
        if (!isActiveStatus(track.status)) {
          stopPolling(trackId)
        }
      } catch (error: unknown) {
        // Один сбой не останавливает polling — повтор на следующем интервале.
        // Но исчерпан бюджет failures → трек, вероятно, мертв (404/403 или
        // длительная сеть): останавливаем, чтобы не тикать вечно до logout.
        consecutiveFailures += 1
        if (consecutiveFailures >= POLLING_FAILURE_BUDGET) {
          stopPolling(trackId)
          useNotificationsStore().push(
            'Статус загрузки недоступен — отслеживание остановлено',
            'warning',
          )
          return
        }
        const status = isApiError(error) ? error.status : 0
        if (status >= 400 && status < 500 && status !== 429) {
          // 4xx (кроме 429 rate-limit) не исправится сам — бюджет не ждём.
          stopPolling(trackId)
          return
        }
      }
    })

    pollers.set(trackId, { controller, abortGroup })
    controller.start()
  }

  function stopPolling(trackId: number): void {
    const poller = pollers.get(trackId)
    if (poller) {
      poller.controller.stop()
      poller.abortGroup.abort()
      pollers.delete(trackId)
    }
    bumpGeneration(trackId)
  }

  function stateForResult(youtubeId: string): DownloadUiState {
    const link = youtubeLinks.get(youtubeId)
    if (!link) {
      return 'idle'
    }
    return link.exists ? 'exists' : 'queued'
  }

  function activeTrackFor(youtubeId: string): Track | null {
    const link = youtubeLinks.get(youtubeId)
    if (!link) {
      return null
    }
    return activeById.value.get(link.trackId) ?? null
  }

  async function queueDownload(result: YouTubeSearchResult): Promise<void> {
    const epochAtStart = epoch
    const response = await queueDownloadRequest({
      youtube_id: result.youtube_id,
      title: result.title,
      author: result.author,
      duration: result.duration,
      webpage_url: result.webpage_url,
      thumbnail_url: result.thumbnail_url,
    })

    if (epoch !== epochAtStart) {
      return
    }

    youtubeLinks.set(result.youtube_id, {
      trackId: response.track.id,
      exists: !response.queued,
    })
    applyTrack(response.track)

    if (isActiveStatus(response.track.status)) {
      startPolling(response.track.id)
    }
  }

  async function restore(): Promise<void> {
    // Мемоизация Promise вместо булева флага: guard'ы роутера при двойной
    // навигации вызывают restore параллельно — оба прохода пройдут проверку
    // флага и оба выполнят fetchActiveDownloads(); поздний снапшот затёр бы
    // треки, поставленные в очередь между ними. Второй вызов теперь просто
    // дожидается первый Promise.
    if (isRestored.value) {
      return
    }
    if (restorePromise) {
      return restorePromise
    }

    const epochAtStart = epoch
    restorePromise = (async () => {
      const response = await fetchActiveDownloads()
      if (epoch !== epochAtStart) {
        return
      }
      active.value = response.items.filter((track) => isActiveStatus(track.status))
      for (const track of active.value) {
        // После reload результат поиска снова должен считаться «в очереди»,
        // иначе кнопка возвращается в idle и допускает повторную постановку.
        youtubeLinks.set(track.youtube_id, { trackId: track.id, exists: false })
        startPolling(track.id)
      }
    })()

    try {
      await restorePromise
      // Признак «восстановление выполнено» ставится только при успехе:
      // сетевой сбой на старте приложения не должен глушить восстановление
      // до пере-логина — следующий restore повторит попытку.
      if (epoch === epochAtStart) {
        isRestored.value = true
      }
    } catch {
      // Ошибка восстановления не блокирует приложение; поллинги, успевшие
      // подняться до ошибки, продолжают работать самостоятельно.
    } finally {
      restorePromise = null
    }
  }

  async function cancelDownload(trackId: number): Promise<void> {
    stopPolling(trackId)
    const generation = generations.get(trackId)
    let track: Track
    try {
      track = await cancelDownloadRequest(trackId)
    } catch {
      // Сбой отмены (сеть/5xx): загрузка продолжает жить на сервере —
      // возобновляем отслеживание, чтобы статус не завис до перезахода.
      if (generations.get(trackId) === generation) {
        startPolling(trackId)
      }
      useNotificationsStore().push('Не удалось отменить загрузку — попробуйте еще раз', 'error')
      return
    }

    if (generations.get(trackId) !== generation) {
      return
    }

    applyTrack(track)
  }

  async function retryDownload(trackId: number): Promise<void> {
    const generation = generations.get(trackId)
    const track = await retryDownloadRequest(trackId)

    if (generations.get(trackId) !== generation) {
      return
    }

    applyTrack(track)

    if (isActiveStatus(track.status)) {
      startPolling(trackId)
    }
  }

  function reset(): void {
    epoch += 1
    for (const trackId of [...pollers.keys()]) {
      stopPolling(trackId)
    }
    active.value = []
    youtubeLinks.clear()
    generations.clear()
    isRestored.value = false
  }

  auth.onSessionTeardown(() => reset())

  return {
    active,
    isRestored,
    activeById,
    stateForResult,
    activeTrackFor,
    queueDownload,
    restore,
    cancelDownload,
    retryDownload,
    startPolling,
    stopPolling,
    reset,
  }
})
