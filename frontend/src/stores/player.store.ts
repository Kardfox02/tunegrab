import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useAuthStore } from '@/stores/auth.store'
import { getCoverAccentColor, getCachedCoverColor } from '@/services/cover-color.service'
import { MediaSessionService } from '@/services/media-session.service'
import { recordListenEvent } from '@/api/events-api'
import type { ListenEventType } from '@/types/events'
import type { Track } from '@/types/track'

export interface PlayerAudioController {
  load(src: string): void
  play(): void
  pause(): void
  seek(time: number): void
  setVolume(volume: number): void
}

const VOLUME_STORAGE_KEY = 'tunegrab.player-volume'

const MAX_RECOVERY_ATTEMPTS = 3
const RECOVERY_DELAY_MS = 1000
const STALL_TIMEOUT_MS = 10000

// Порог «дослушал»: доля воспроизведения, начиная с которой ended считается
// complete, а не skip. Совпадает с серверным правилом в ListenEventCreate.
const COMPLETE_FRACTION = 0.9

function clampVolume(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function readStoredVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY)
    if (raw === null) {
      return 1
    }
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      return 1
    }
    return clampVolume(parsed)
  } catch {
    return 1
  }
}

function persistVolume(volume: number): void {
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume))
  } catch {
    // Приватный режим браузера может запрещать запись — громкость живет в памяти.
  }
}

export const usePlayerStore = defineStore('player', () => {
  const auth = useAuthStore()

  const currentTrack = ref<Track | null>(null)
  const queue = ref<Track[]>([])
  const isPlaying = ref(false)
  const position = ref(0)
  const duration = ref(0)
  const volume = ref(readStoredVolume())
  const isLoading = ref(false)
  const playbackError = ref<string | null>(null)
  // Контрастный акцент под цвет обложки текущего трека (CSS var --track-accent).
  const trackAccent = ref<string | null>(null)

  const hasCurrentTrack = computed(() => currentTrack.value !== null)
  const isQueueEmpty = computed(() => queue.value.length === 0)

  let audioController: PlayerAudioController | null = null
  let queueSupplier: ((lastTrackId: number) => Promise<Track[]>) | null = null
  let playbackEpoch = 0
  let extensionInFlight = false
  let contextList: Track[] = []
  let contextIndex = -1
  let recoveryAttempts = 0
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let pendingResumeAt: number | null = null
  let reportedPlayTrackId: number | null = null
  // Накопленное фактически прослушанное время (сек) в текущем треке:
  // перемотка не превращает непрослушанный кусок в прослушанный.
  let listenedSeconds = 0
  let lastTickPosition: number | null = null

  const mediaSession = new MediaSessionService({
    onPlay() {
      play()
    },
    onPause() {
      pause()
    },
    onNext() {
      playNext()
    },
    onPrevious() {
      playPrevious()
    },
  })

  function clearRecoveryTimers(): void {
    if (recoveryTimer !== null) {
      clearTimeout(recoveryTimer)
      recoveryTimer = null
    }
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
      stallTimer = null
    }
  }

  function resetRecovery(): void {
    clearRecoveryTimers()
    recoveryAttempts = 0
    pendingResumeAt = null
  }

  function trackFraction(): number {
    if (duration.value <= 0) {
      return 0
    }
    return Math.min(1, Math.max(0, position.value / duration.value))
  }

  // Прибавляем только «шаг воспроизведения» (≤2 c) между тиками: большой
  // скачок — перемотка, непрослушанный кусок не становится прослушанным.
  const MAX_TICK_DELTA_SECONDS = 2

  function accumulateListenedTime(): void {
    if (lastTickPosition !== null) {
      const delta = position.value - lastTickPosition
      if (delta > 0 && delta <= MAX_TICK_DELTA_SECONDS) {
        listenedSeconds += delta
      }
    }
    lastTickPosition = position.value
  }

  function resetListenedTime(): void {
    listenedSeconds = 0
    lastTickPosition = null
  }

  // Доля трека по фактическому времени, с фоллбэком на позицию, когда тиков
  // ещё не было (старт без перемоток).
  function listenedFraction(): number {
    if (duration.value <= 0) {
      return 0
    }
    if (lastTickPosition === null) {
      return trackFraction()
    }
    return Math.min(1, Math.max(0, listenedSeconds / duration.value))
  }

  // Обрыв фонового стрима (Doze Android, разрыв туннеля) не должен останавливать
  // плеер: перезагружаем источник и продолжаем с сохранённой позиции.
  function attemptRecovery(): void {
    const track = currentTrack.value
    if (!track?.audio_url || recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      playbackError.value = 'Не удалось воспроизвести трек'
      isPlaying.value = false
      isLoading.value = false
      mediaSession.setPaused()
      clearRecoveryTimers()
      return
    }

    recoveryAttempts += 1
    pendingResumeAt = position.value
    isLoading.value = true
    audioController?.load(track.audio_url)
    audioController?.play()
  }

  function scheduleRecovery(): void {
    clearRecoveryTimers()
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null
      attemptRecovery()
    }, RECOVERY_DELAY_MS)
  }

  function armStallWatchdog(): void {
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
    }
    stallTimer = setTimeout(() => {
      stallTimer = null
      if (isPlaying.value) {
        scheduleRecovery()
      }
    }, STALL_TIMEOUT_MS)
  }

  function isPlayable(track: Track): boolean {
    return track.status === 'done' && track.audio_url !== null
  }

  function findPlayableForward(from: number): number {
    for (let index = from + 1; index < contextList.length; index += 1) {
      if (isPlayable(contextList[index] as Track)) {
        return index
      }
    }
    return -1
  }

  function findPlayableBackward(from: number): number {
    for (let index = from - 1; index >= 0; index -= 1) {
      if (isPlayable(contextList[index] as Track)) {
        return index
      }
    }
    return -1
  }

  function bindAudioController(controller: PlayerAudioController | null): void {
    audioController = controller
    controller?.setVolume(volume.value)
  }

  function setQueueSupplier(
    supplier: ((lastTrackId: number) => Promise<Track[]>) | null,
  ): void {
    queueSupplier = supplier
  }

  // Телеметрия прослушиваний — fire-and-forget: ошибки сети не должны
  // влиять на воспроизведение (у события нет пользовательского фидбэка).
  function reportEvent(eventType: ListenEventType, fraction: number): void {
    const track = currentTrack.value
    if (!track) {
      return
    }
    void recordListenEvent({
      track_id: track.id,
      event_type: eventType,
      fraction_played: Math.min(1, Math.max(0, fraction)),
    }).catch(() => {
      // Телеметрия не критична: молча пропускаем сбои.
    })
  }

  function reset(): void {
    audioController = null
    queueSupplier = null
    playbackEpoch += 1
    extensionInFlight = false
    resetRecovery()
    reportedPlayTrackId = null
    resetListenedTime()
    contextList = []
    contextIndex = -1
    currentTrack.value = null
    queue.value = []
    isPlaying.value = false
    position.value = 0
    duration.value = 0
    isLoading.value = false
    playbackError.value = null
    trackAccent.value = null
    mediaSession.setTrack(null)
  }

  function playTrack(track: Track): void {
    if (!track.audio_url) {
      playbackError.value = 'Трек недоступен для воспроизведения'
      return
    }

    // Ручной уход с играющего трека до порога — skip (по фактическому времени).
    if (isPlaying.value && currentTrack.value && currentTrack.value.id !== track.id) {
      reportEvent('skip', listenedFraction())
    }

    playbackEpoch += 1
    playbackError.value = null
    resetRecovery()
    reportedPlayTrackId = null
    resetListenedTime()
    currentTrack.value = track
    position.value = 0
    duration.value = track.duration ?? 0
    isLoading.value = true
    trackAccent.value = track.cover_url ? getCachedCoverColor(track.cover_url) : null
    mediaSession.setTrack(track)
    audioController?.load(track.audio_url)
    audioController?.play()
  }

  function playFromList(track: Track, list: Track[]): void {
    const index = list.findIndex((item) => item.id === track.id)

    if (index >= 0) {
      contextList = [...list]
      contextIndex = index
    } else {
      contextList = []
      contextIndex = -1
    }

    playTrack(track)
  }

  function playOrToggle(track: Track, list: Track[]): void {
    if (currentTrack.value?.id === track.id) {
      togglePlay()
      return
    }

    playFromList(track, list)
  }

  function play(): void {
    if (!currentTrack.value) {
      return
    }
    playbackError.value = null
    audioController?.play()
  }

  function pause(): void {
    audioController?.pause()
  }

  function togglePlay(): void {
    if (isPlaying.value) {
      pause()
      return
    }
    play()
  }

  function seek(time: number): void {
    if (!currentTrack.value) {
      return
    }
    const clamped = Math.max(0, Math.min(time, duration.value || time))
    position.value = clamped
    // Перемотка сама по себе не добавляет прослушанное время, но задаёт
    // новую точку отсчёта: следующий тик от неё — реальное прослушивание.
    lastTickPosition = clamped
    audioController?.seek(clamped)
  }

  function setVolume(value: number): void {
    const clamped = clampVolume(value)
    volume.value = clamped
    persistVolume(clamped)
    audioController?.setVolume(clamped)
  }

  function addToQueue(track: Track): void {
    if (currentTrack.value?.id === track.id) {
      return
    }
    if (queue.value.some((item) => item.id === track.id)) {
      return
    }
    queue.value = [...queue.value, track]
  }

  function removeFromQueue(trackId: number): void {
    queue.value = queue.value.filter((item) => item.id !== trackId)
  }

  function removeTrack(trackId: number): void {
    queue.value = queue.value.filter((item) => item.id !== trackId)

    if (currentTrack.value?.id !== trackId) {
      return
    }

    audioController?.pause()
    isPlaying.value = false
    currentTrack.value = null
    position.value = 0
    duration.value = 0
    isLoading.value = false
    playbackError.value = null
    mediaSession.setTrack(null)
  }

  function clearQueue(): void {
    queue.value = []
  }

  function playFromQueueHead(): void {
    const [next, ...rest] = queue.value
    if (!next) {
      audioController?.pause()
      isPlaying.value = false
      return
    }

    queue.value = rest
    playTrack(next)
  }

  function playNext(): void {
    const nextIndex = findPlayableForward(contextIndex)
    if (nextIndex >= 0) {
      contextIndex = nextIndex
      playTrack(contextList[nextIndex] as Track)
      return
    }

    if (queue.value.length > 0) {
      playFromQueueHead()
    }
  }

  function playPrevious(): void {
    const prevIndex = findPlayableBackward(contextIndex)
    if (prevIndex >= 0) {
      contextIndex = prevIndex
      playTrack(contextList[prevIndex] as Track)
    }
  }

  async function extendContext(): Promise<void> {
    const supplier = queueSupplier
    const current = currentTrack.value
    if (!supplier || extensionInFlight || !current) {
      return
    }

    extensionInFlight = true
    const epochAtStart = playbackEpoch
    try {
      const fetched = await supplier(current.id)
      if (epochAtStart !== playbackEpoch) {
        return
      }
      const knownIds = new Set<number>(contextList.map((item) => item.id))
      knownIds.add(current.id)
      for (const item of queue.value) {
        knownIds.add(item.id)
      }
      const fresh = fetched.filter((item) => isPlayable(item) && !knownIds.has(item.id))
      if (fresh.length > 0) {
        queue.value = [...queue.value, ...fresh]
      }
    } catch {
      // Prefetch — инициативная догрузка; при неудаче сработает путь через ended.
    } finally {
      extensionInFlight = false
    }
  }

  function audioPlaying(): void {
    isPlaying.value = true
    isLoading.value = false
    mediaSession.setPlaying()
    resetRecovery()

    // Событие play — один раз на трек (recovery и повторные play после паузы
    // не должны дуть телеметрию повторно).
    if (currentTrack.value && reportedPlayTrackId !== currentTrack.value.id) {
      reportedPlayTrackId = currentTrack.value.id
      reportEvent('play', 0)
    }

    const hasContextNext = findPlayableForward(contextIndex) >= 0
    if (!hasContextNext) {
      void extendContext()
    }
  }

  function audioPaused(): void {
    isPlaying.value = false
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
      stallTimer = null
    }
    mediaSession.setPaused()
  }

  function audioTimeUpdate(time: number): void {
    position.value = time
    accumulateListenedTime()
    if (isPlaying.value) {
      armStallWatchdog()
    }
  }

  function audioDurationChanged(value: number): void {
    if (Number.isFinite(value) && value > 0) {
      duration.value = value
    }
  }

  function audioWaiting(): void {
    isLoading.value = true
  }

  function audioCanPlay(): void {
    isLoading.value = false
    if (pendingResumeAt !== null && audioController !== null) {
      const resumeAt = Math.min(pendingResumeAt, duration.value || pendingResumeAt)
      pendingResumeAt = null
      audioController.seek(resumeAt)
      position.value = resumeAt
      // Recovery восстанавливает позицию — новая точка отсчёта тиков.
      lastTickPosition = resumeAt
    }
  }

  async function audioEnded(): Promise<void> {
    isPlaying.value = false

    // Дослушивание: ended с высокой долей по фактическому времени — complete.
    // Перемотка на середину с дослушиванием даст ~0.5, а не 1.0.
    const fraction = listenedFraction()
    reportEvent(fraction >= COMPLETE_FRACTION ? 'complete' : 'skip', fraction)
    reportedPlayTrackId = null
    resetListenedTime()
    position.value = 0

    if (queue.value.length > 0) {
      playFromQueueHead()
      return
    }

    const nextIndex = findPlayableForward(contextIndex)
    if (nextIndex >= 0) {
      contextIndex = nextIndex
      playTrack(contextList[nextIndex] as Track)
      return
    }

    const supplier = queueSupplier
    const current = currentTrack.value
    if (!supplier || !current) {
      audioController?.pause()
      return
    }

    const epochAtStart = playbackEpoch
    isLoading.value = true
    try {
      const fetched = await supplier(current.id)
      if (epochAtStart !== playbackEpoch || currentTrack.value !== current) {
        return
      }

      const knownIds = new Set<number>([current.id])
      const playable = fetched.filter((item) => isPlayable(item) && !knownIds.has(item.id))
      if (playable.length === 0) {
        isLoading.value = false
        audioController?.pause()
        return
      }

      queue.value = playable
      playNext()
    } catch {
      isLoading.value = false
      audioController?.pause()
    }
  }

  function audioFailed(message: string): void {
    isPlaying.value = false
    // Обрыв сети — штатная ситуация для фонового стрима: сначала восстановление,
    // постоянная ошибка выставляется только после исчерпания попыток.
    scheduleRecovery()
    void message
  }

  auth.onSessionTeardown(() => reset())
  // Обложка могла ещё не попасть в кэш на момент playTrack — дотягиваем цвет,
  // когда извлечение завершится (текущий трек не сменился).
  watch(
    () => currentTrack.value?.cover_url ?? null,
    (coverUrl) => {
      if (!coverUrl) {
        trackAccent.value = null
        return
      }
      const epochAtStart = playbackEpoch
      void getCoverAccentColor(coverUrl).then((color) => {
        if (epochAtStart === playbackEpoch && currentTrack.value?.cover_url === coverUrl && color) {
          trackAccent.value = color
        }
      })
    },
    { immediate: true },
  )

  return {
    currentTrack,
    queue,
    isPlaying,
    position,
    duration,
    volume,
    isLoading,
    playbackError,
    trackAccent,
    hasCurrentTrack,
    isQueueEmpty,
    bindAudioController,
    setQueueSupplier,
    playFromList,
    playOrToggle,
    reset,
    playTrack,
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
    addToQueue,
    removeFromQueue,
    playFromQueueHead,
    removeTrack,
    clearQueue,
    playNext,
    playPrevious,
    audioPlaying,
    audioPaused,
    audioTimeUpdate,
    audioDurationChanged,
    audioWaiting,
    audioCanPlay,
    audioEnded,
    audioFailed,
  }
})
