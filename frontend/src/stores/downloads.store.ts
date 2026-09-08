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
import type { Track, TrackStatus } from '@/types/track'
import type { YouTubeSearchResult } from '@/types/youtube'

export type DownloadUiState = 'idle' | 'queued' | 'exists'

const ACTIVE_STATUSES: readonly TrackStatus[] = ['pending', 'downloading', 'converting', 'finalizing']

function isActiveStatus(status: TrackStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

export const useDownloadsStore = defineStore('downloads', () => {
  const auth = useAuthStore()

  const active = ref<Track[]>([])
  const isRestored = ref(false)

  const youtubeLinks = reactive(new Map<string, { trackId: number; exists: boolean }>())
  const generations = new Map<number, number>()
  const pollers = new Map<number, { controller: PollingController; abortGroup: AbortGroup }>()
  let epoch = 0

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

    const controller = createPolling(async () => {
      try {
        const track = await fetchDownloadStatus(trackId, abortGroup.nextSignal())
        if (generation === undefined || generations.get(trackId) !== generation) {
          return
        }
        applyTrack(track)
        if (!isActiveStatus(track.status)) {
          stopPolling(trackId)
        }
      } catch {
        // Сетевые сбои не останавливают polling — повтор на следующем интервале.
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
    if (isRestored.value) {
      return
    }

    const epochAtStart = epoch
    try {
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
    } catch {
      // Ошибка восстановления не блокирует приложение — статусы подтянутся через /tracks.
    } finally {
      if (epoch === epochAtStart) {
        isRestored.value = true
      }
    }
  }

  async function cancelDownload(trackId: number): Promise<void> {
    stopPolling(trackId)
    const generation = generations.get(trackId)
    const track = await cancelDownloadRequest(trackId)

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
