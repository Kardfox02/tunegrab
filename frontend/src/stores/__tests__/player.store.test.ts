import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { recordListenEvent } from '@/api/events-api'
import { useAuthStore } from '@/stores/auth.store'
import { usePlayerStore, type PlayerAudioController } from '@/stores/player.store'
import type { Track } from '@/types/track'

vi.mock('@/api/events-api', () => ({
  recordListenEvent: vi.fn().mockResolvedValue(undefined),
}))

const mockedRecordEvent = vi.mocked(recordListenEvent)

function createControllerMock(): PlayerAudioController & Record<keyof PlayerAudioController, Mock> {
  return {
    load: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
  }
}

function createTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 1,
    youtube_id: 'video-1',
    title: 'Song',
    author: 'Artist',
    duration: 200,
    status: 'done',
    progress: 100,
    file_size: 1024,
    created_at: '2026-09-01T00:00:00Z',
    audio_url: '/stream/1',
    cover_url: null,
    ...overrides,
  }
}

describe('player store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.localStorage.removeItem('tunegrab.player-volume')
    mockedRecordEvent.mockClear()
    mockedRecordEvent.mockResolvedValue(undefined)
  })

  it('plays a track with a playable source and issues load/play commands', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    player.playTrack(createTrack())

    expect(player.currentTrack?.id).toBe(1)
    expect(player.position).toBe(0)
    expect(player.duration).toBe(200)
    expect(player.isLoading).toBe(true)
    expect(player.playbackError).toBeNull()
    expect(controller.load).toHaveBeenCalledWith('/stream/1')
    expect(controller.play).toHaveBeenCalledOnce()
  })

  it('rejects tracks without an audio source', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    player.playTrack(createTrack({ audio_url: null }))

    expect(player.currentTrack).toBeNull()
    expect(player.playbackError).not.toBeNull()
    expect(controller.load).not.toHaveBeenCalled()
    expect(controller.play).not.toHaveBeenCalled()
  })

  it('toggles pause when playOrToggle is called for the current track', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    const list = [createTrack({ id: 1 }), createTrack({ id: 2, audio_url: '/stream/2' })]
    player.playFromList(list[0] as Track, list)
    player.audioPlaying()
    const playsAfterStart = controller.play.mock.calls.length

    // Тот же трек во время игры: пауза (isPlaying гаснет через pause-событие),
    // затем возобновление. Перезапуска (controller.load) быть не должно.
    player.playOrToggle(list[0] as Track, list)
    expect(controller.pause).toHaveBeenCalledOnce()
    player.audioPaused()

    player.playOrToggle(list[0] as Track, list)
    expect(controller.play.mock.calls.length).toBe(playsAfterStart + 1)
    expect(controller.load).toHaveBeenCalledTimes(1)
    expect(player.currentTrack?.id).toBe(1)
  })

  it('restarts with a new context when playOrToggle gets a different track', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    const list = [createTrack({ id: 1 }), createTrack({ id: 2, audio_url: '/stream/2' })]
    player.playFromList(list[0] as Track, list)

    player.playOrToggle(list[1] as Track, list)

    expect(player.currentTrack?.id).toBe(2)
    expect(controller.load).toHaveBeenCalledWith('/stream/2')
    expect(controller.play).toHaveBeenCalledTimes(2)
  })

  it('delegates playback commands and persists volume', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)
    player.playTrack(createTrack())

    player.togglePlay()
    expect(controller.play).toHaveBeenCalledTimes(2)

    player.audioPlaying()
    player.togglePlay()
    expect(controller.pause).toHaveBeenCalledOnce()

    player.seek(30)
    expect(player.position).toBe(30)
    expect(controller.seek).toHaveBeenCalledWith(30)

    player.setVolume(0.5)
    expect(player.volume).toBe(0.5)
    expect(controller.setVolume).toHaveBeenCalledWith(0.5)
    expect(window.localStorage.getItem('tunegrab.player-volume')).toBe('0.5')

    player.setVolume(5)
    expect(player.volume).toBe(1)
  })

  it('advances through the context list skipping unplayable tracks on end', async () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    const list = [
      createTrack({ id: 1, audio_url: '/stream/1' }),
      createTrack({ id: 2, status: 'error' }),
      createTrack({ id: 3, audio_url: '/stream/3', title: 'Third' }),
      createTrack({ id: 4, status: 'pending' }),
    ]
    player.playFromList(list[0] as Track, list)

    expect(player.queue).toHaveLength(0)

    await player.audioEnded()
    expect(player.currentTrack?.id).toBe(3)
    expect(controller.load).toHaveBeenLastCalledWith('/stream/3')

    await player.audioEnded()
    expect(player.isPlaying).toBe(false)
    expect(player.currentTrack?.id).toBe(3)
  })

  it('navigates back and forward through the context via prev/next', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    const list = [
      createTrack({ id: 1, audio_url: '/stream/1' }),
      createTrack({ id: 2, audio_url: '/stream/2' }),
      createTrack({ id: 3, audio_url: '/stream/3' }),
    ]
    player.playFromList(list[1] as Track, list)

    player.playPrevious()
    expect(player.currentTrack?.id).toBe(1)
    expect(controller.load).toHaveBeenLastCalledWith('/stream/1')

    player.playNext()
    expect(player.currentTrack?.id).toBe(2)
    expect(controller.load).toHaveBeenLastCalledWith('/stream/2')

    player.playPrevious()
    player.playPrevious()
    expect(player.currentTrack?.id).toBe(1)
  })

  it('prefetches more tracks while the last queued track plays', async () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    let supplierCalls = 0

    player.setQueueSupplier(async () => {
      supplierCalls += 1
      return [
        createTrack({ id: 2, audio_url: '/stream/2' }),
        createTrack({ id: 3, status: 'downloading' }),
      ]
    })

    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.audioPlaying()
    await flushPromises()
    expect(supplierCalls).toBe(1)
    expect(player.queue.map((track) => track.id)).toEqual([2])

    player.audioPlaying()
    await flushPromises()
    expect(supplierCalls).toBe(2)
    expect(player.queue.map((track) => track.id)).toEqual([2])
  })

  it('continues into the supplied page when the queue runs dry on end', async () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    player.setQueueSupplier(async () => [
      createTrack({ id: 51, audio_url: '/stream/51', title: 'Next Page' }),
    ])
    player.playTrack(createTrack({ id: 50, audio_url: '/stream/50' }))

    await player.audioEnded()
    await flushPromises()

    expect(player.currentTrack?.id).toBe(51)
    expect(controller.load).toHaveBeenLastCalledWith('/stream/51')
    expect(controller.play).toHaveBeenCalledTimes(2)
    expect(player.isLoading).toBe(true)
  })

  it('stops when the supplier has nothing more to play', async () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)
    player.setQueueSupplier(async () => [])

    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    await player.audioEnded()
    await flushPromises()

    expect(player.isPlaying).toBe(false)
    expect(controller.pause).toHaveBeenCalledOnce()
  })

  it('ignores supplier results when playback moved on', async () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    let resolveSupplier: ((tracks: Track[]) => void) | undefined
    player.setQueueSupplier(
      () =>
        new Promise<Track[]>((resolve) => {
          resolveSupplier = resolve
        }),
    )

    player.playTrack(createTrack({ id: 50, audio_url: '/stream/50' }))
    player.audioPlaying()
    await flushPromises()

    player.playTrack(createTrack({ id: 77, audio_url: '/stream/77' }))
    resolveSupplier?.([createTrack({ id: 51, audio_url: '/stream/51' })])
    await flushPromises()

    expect(player.currentTrack?.id).toBe(77)
    expect(player.queue).toHaveLength(0)
    expect(controller.load).not.toHaveBeenCalledWith('/stream/51')
  })

  it('restores stored volume when the controller binds', () => {
    window.localStorage.setItem('tunegrab.player-volume', '0.25')
    const player = usePlayerStore()
    expect(player.volume).toBe(0.25)

    const controller = createControllerMock()
    player.bindAudioController(controller)
    expect(controller.setVolume).toHaveBeenCalledWith(0.25)
  })

  it('clamps seek into the valid range', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)
    player.playTrack(createTrack())

    player.seek(-10)
    expect(player.position).toBe(0)

    player.seek(500)
    expect(player.position).toBe(200)
    expect(controller.seek).toHaveBeenLastCalledWith(200)
  })

  it('advances to the next queued track on end', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)
    const first = createTrack({ id: 1, audio_url: '/stream/1' })
    const second = createTrack({ id: 2, audio_url: '/stream/2', title: 'Second' })
    player.playTrack(first)
    player.addToQueue(second)

    player.audioEnded()

    expect(player.currentTrack?.id).toBe(2)
    expect(player.queue).toHaveLength(0)
    expect(controller.load).toHaveBeenLastCalledWith('/stream/2')
    expect(controller.play).toHaveBeenCalledTimes(2)
  })

  it('stops on end when the queue is empty', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)
    player.playTrack(createTrack())

    player.audioEnded()

    expect(player.isPlaying).toBe(false)
    expect(player.position).toBe(0)
    expect(player.currentTrack?.id).toBe(1)
    expect(controller.pause).toHaveBeenCalledOnce()
  })

  it('manages the queue without duplicates', () => {
    const player = usePlayerStore()
    const first = createTrack({ id: 1 })
    const second = createTrack({ id: 2 })

    player.playTrack(first)
    player.addToQueue(second)
    player.addToQueue(second)
    expect(player.queue).toHaveLength(1)

    player.addToQueue(first)
    expect(player.queue).toHaveLength(1)

    player.removeFromQueue(second.id)
    expect(player.isQueueEmpty).toBe(true)

    player.addToQueue(second)
    player.clearQueue()
    expect(player.queue).toHaveLength(0)
  })

  it('removes a queued track without touching the current one', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)
    player.playTrack(createTrack({ id: 1 }))
    player.addToQueue(createTrack({ id: 2 }))
    player.addToQueue(createTrack({ id: 3 }))

    player.removeTrack(2)

    expect(player.currentTrack?.id).toBe(1)
    expect(player.queue.map((track) => track.id)).toEqual([3])
    expect(controller.pause).not.toHaveBeenCalled()
  })

  it('stops playback and clears state when the current track is removed', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)
    player.playTrack(createTrack({ id: 1 }))
    player.addToQueue(createTrack({ id: 2 }))
    player.audioPlaying()
    player.audioTimeUpdate(30)

    player.removeTrack(1)

    expect(player.currentTrack).toBeNull()
    expect(player.queue.map((track) => track.id)).toEqual([2])
    expect(player.isPlaying).toBe(false)
    expect(player.position).toBe(0)
    expect(controller.pause).toHaveBeenCalledOnce()
  })

  it('syncs state from audio events', () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.playTrack(createTrack())

    player.audioTimeUpdate(42)
    expect(player.position).toBe(42)

    player.audioDurationChanged(321)
    expect(player.duration).toBe(321)

    player.audioDurationChanged(Number.NaN)
    expect(player.duration).toBe(321)

    player.audioWaiting()
    expect(player.isLoading).toBe(true)

    player.audioCanPlay()
    expect(player.isLoading).toBe(false)

    player.audioPlaying()
    expect(player.isPlaying).toBe(true)

    player.audioPaused()
    expect(player.isPlaying).toBe(false)
  })

  it('recovers playback with the same source after a failure', () => {
    vi.useFakeTimers()
    try {
      const player = usePlayerStore()
      const controller = createControllerMock()
      player.bindAudioController(controller)
      player.playTrack(createTrack())
      player.audioPlaying()
      player.audioTimeUpdate(30)
      const loadsAfterStart = controller.load.mock.calls.length

      player.audioFailed('Не удалось воспроизвести трек')

      expect(player.playbackError).toBeNull()
      vi.advanceTimersByTime(1000)

      expect(controller.load.mock.calls.length).toBe(loadsAfterStart + 1)
      expect(controller.load).toHaveBeenLastCalledWith('/stream/1')
      expect(controller.play).toHaveBeenCalledTimes(2)
      expect(player.isLoading).toBe(true)

      player.audioCanPlay()
      expect(controller.seek).toHaveBeenCalledWith(30)
      expect(player.position).toBe(30)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resets recovery state when playback successfully starts', () => {
    vi.useFakeTimers()
    try {
      const player = usePlayerStore()
      const controller = createControllerMock()
      player.bindAudioController(controller)
      player.playTrack(createTrack())

      player.audioFailed('обрыв')
      vi.advanceTimersByTime(1000)
      player.audioPlaying()

      const loadsAfterRecovery = controller.load.mock.calls.length

      player.audioFailed('ещё обрыв')
      vi.advanceTimersByTime(1000)

      expect(controller.load.mock.calls.length).toBe(loadsAfterRecovery + 1)
      expect(player.playbackError).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after the maximum number of recovery attempts', () => {
    vi.useFakeTimers()
    try {
      const player = usePlayerStore()
      const controller = createControllerMock()
      player.bindAudioController(controller)
      player.playTrack(createTrack())

      for (let attempt = 0; attempt < 3; attempt += 1) {
        player.audioFailed('обрыв')
        vi.advanceTimersByTime(1000)
      }
      expect(player.playbackError).toBeNull()

      player.audioFailed('обрыв')
      vi.advanceTimersByTime(1000)

      expect(player.playbackError).toBe('Не удалось воспроизвести трек')
      expect(player.isPlaying).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers via the stall watchdog when ticks stop while playing', () => {
    vi.useFakeTimers()
    try {
      const player = usePlayerStore()
      const controller = createControllerMock()
      player.bindAudioController(controller)
      player.playTrack(createTrack())
      player.audioPlaying()
      const loadsAfterStart = controller.load.mock.calls.length

      player.audioTimeUpdate(10)
      vi.advanceTimersByTime(11000)

      expect(controller.load.mock.calls.length).toBe(loadsAfterStart + 1)
      expect(player.isLoading).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not trigger the stall watchdog while paused', () => {
    vi.useFakeTimers()
    try {
      const player = usePlayerStore()
      const controller = createControllerMock()
      player.bindAudioController(controller)
      player.playTrack(createTrack())
      player.audioPlaying()
      player.audioTimeUpdate(10)
      player.audioPaused()
      const loadsAfterPause = controller.load.mock.calls.length

      vi.advanceTimersByTime(30000)

      expect(controller.load.mock.calls.length).toBe(loadsAfterPause)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears recovery timers when the track changes', () => {
    vi.useFakeTimers()
    try {
      const player = usePlayerStore()
      const controller = createControllerMock()
      player.bindAudioController(controller)
      player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))

      player.audioFailed('обрыв')
      player.playTrack(createTrack({ id: 2, audio_url: '/stream/2' }))
      const loadsAfterSwitch = controller.load.mock.calls.length

      vi.advanceTimersByTime(5000)

      expect(controller.load.mock.calls.length).toBe(loadsAfterSwitch)
      expect(player.playbackError).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a play event once per track when playback starts', async () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.playTrack(createTrack())

    expect(mockedRecordEvent).not.toHaveBeenCalled()

    player.audioPlaying()
    await flushPromises()
    player.audioPaused()
    player.audioPlaying()
    await flushPromises()

    expect(mockedRecordEvent).toHaveBeenCalledTimes(1)
    expect(mockedRecordEvent).toHaveBeenCalledWith({
      track_id: 1,
      event_type: 'play',
      fraction_played: 0,
    })
  })

  it('reports skip when switching tracks mid-playback below the threshold', async () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.audioPlaying()
    player.audioDurationChanged(200)
    // Тики по 1 с: накоплено 40 с фактического прослушивания из 200 (0.2).
    player.audioTimeUpdate(0)
    for (let second = 1; second <= 40; second += 1) {
      player.audioTimeUpdate(second)
    }

    player.playTrack(createTrack({ id: 2, audio_url: '/stream/2', title: 'Second' }))
    await flushPromises()

    expect(mockedRecordEvent).toHaveBeenCalledTimes(2)
    expect(mockedRecordEvent).toHaveBeenLastCalledWith({
      track_id: 1,
      event_type: 'skip',
      fraction_played: 0.2,
    })
  })

  it('reports complete on ended at or above the threshold', async () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.setQueueSupplier(async () => [])
    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.audioPlaying()
    player.audioDurationChanged(200)
    // 190 с непрерывного прослушивания из 200 (0.95).
    player.audioTimeUpdate(0)
    for (let second = 1; second <= 190; second += 1) {
      player.audioTimeUpdate(second)
    }

    await player.audioEnded()
    await flushPromises()

    expect(mockedRecordEvent).toHaveBeenCalledTimes(2)
    expect(mockedRecordEvent).toHaveBeenLastCalledWith({
      track_id: 1,
      event_type: 'complete',
      fraction_played: 0.95,
    })
  })

  it('reports skip on ended below the threshold', async () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.setQueueSupplier(async () => [])
    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.audioPlaying()
    player.audioDurationChanged(200)
    // 60 с прослушивания из 200 (0.3).
    player.audioTimeUpdate(0)
    for (let second = 1; second <= 60; second += 1) {
      player.audioTimeUpdate(second)
    }

    await player.audioEnded()
    await flushPromises()

    expect(mockedRecordEvent).toHaveBeenCalledTimes(2)
    expect(mockedRecordEvent).toHaveBeenLastCalledWith({
      track_id: 1,
      event_type: 'skip',
      fraction_played: 0.3,
    })
  })

  it('counts only actually listened time when seeking to the middle and finishing', async () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.setQueueSupplier(async () => [])
    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.audioPlaying()
    player.audioDurationChanged(200)
    // 10 с в начале.
    player.audioTimeUpdate(0)
    for (let second = 1; second <= 10; second += 1) {
      player.audioTimeUpdate(second)
    }

    // Перемотка на середину (скачок не считается прослушанным) и дослушивание
    // до конца: накоплено ещё 90 с. Итого 100 с из 200 = 0.5.
    player.seek(110)
    for (let second = 111; second <= 200; second += 1) {
      player.audioTimeUpdate(second)
    }

    await player.audioEnded()
    await flushPromises()

    expect(mockedRecordEvent).toHaveBeenCalledTimes(2)
    expect(mockedRecordEvent).toHaveBeenLastCalledWith({
      track_id: 1,
      event_type: 'skip',
      fraction_played: 0.5,
    })
  })

  it('reports complete for a far seek followed by real listening', async () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.setQueueSupplier(async () => [])
    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.audioPlaying()
    player.audioDurationChanged(200)
    player.audioTimeUpdate(5)

    // Перемотка почти в конец + 185 с реального прослушивания: 185/200 = 0.925.
    player.seek(15)
    for (let second = 16; second <= 200; second += 1) {
      player.audioTimeUpdate(second)
    }

    await player.audioEnded()
    await flushPromises()

    expect(mockedRecordEvent).toHaveBeenLastCalledWith({
      track_id: 1,
      event_type: 'complete',
      fraction_played: 0.925,
    })
  })

  it('resets the listened time when the track changes', async () => {
    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.audioPlaying()
    player.audioDurationChanged(200)
    // 190 с из 200 (0.95) → skip по фактическому времени при ручном уходе.
    player.audioTimeUpdate(0)
    for (let second = 1; second <= 190; second += 1) {
      player.audioTimeUpdate(second)
    }
    const eventsAfterFirstTrack = mockedRecordEvent.mock.calls.length

    player.playTrack(createTrack({ id: 2, audio_url: '/stream/2', title: 'Second' }))
    await flushPromises()

    expect(mockedRecordEvent).toHaveBeenNthCalledWith(eventsAfterFirstTrack + 1, {
      track_id: 1,
      event_type: 'skip',
      fraction_played: 0.95,
    })

    // Новый трек: счётчик сброшен — 20 с из 200 (0.1) на ended.
    player.audioPlaying()
    player.audioDurationChanged(200)
    player.audioTimeUpdate(0)
    for (let second = 1; second <= 20; second += 1) {
      player.audioTimeUpdate(second)
    }
    await player.audioEnded()
    await flushPromises()

    expect(mockedRecordEvent).toHaveBeenLastCalledWith({
      track_id: 2,
      event_type: 'skip',
      fraction_played: 0.1,
    })
  })

  it('swallows telemetry failures without affecting playback', async () => {
    mockedRecordEvent.mockRejectedValueOnce(new Error('network down'))

    const player = usePlayerStore()
    player.bindAudioController(createControllerMock())
    player.playTrack(createTrack())

    player.audioPlaying()
    await flushPromises()

    expect(player.isPlaying).toBe(true)
    expect(player.playbackError).toBeNull()
  })

  it('clears the player when the session is torn down', () => {
    const player = usePlayerStore()
    const auth = useAuthStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)
    player.playTrack(createTrack())
    player.addToQueue(createTrack({ id: 2 }))

    auth.markUnauthenticated()

    expect(player.currentTrack).toBeNull()
    expect(player.queue).toHaveLength(0)
    expect(player.isPlaying).toBe(false)
    expect(player.position).toBe(0)

    player.playTrack(createTrack({ id: 3, audio_url: '/stream/3' }))
    expect(controller.load).not.toHaveBeenCalledWith('/stream/3')
  })

  it('clears stale prefetch queue when a new context is selected', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    // Первая сессия: prefetch наполнил очередь треками 51–52.
    player.playTrack(createTrack({ id: 50, audio_url: '/stream/50' }))
    player.addToQueue(createTrack({ id: 51, audio_url: '/stream/51', title: 'Stale A' }))
    player.addToQueue(createTrack({ id: 52, audio_url: '/stream/52', title: 'Stale B' }))

    // Новый контекст из начала библиотеки.
    const list = [
      createTrack({ id: 5, audio_url: '/stream/5' }),
      createTrack({ id: 6, audio_url: '/stream/6' }),
    ]
    player.playFromList(list[0] as Track, list)

    expect(player.queue).toHaveLength(0)

    // По ended должен играть сосед по новому контексту, а не трек 51.
    player.audioEnded()
    expect(player.currentTrack?.id).toBe(6)
    expect(controller.load).toHaveBeenLastCalledWith('/stream/6')
  })

  it('does not replay listened tracks returned by the supplier', async () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    // Supplier имитирует сброс курсора библиотеки: возвращает страницу,
    // содержащую уже прослушанный трек 1 и новый трек 2.
    player.setQueueSupplier(async () => [
      createTrack({ id: 1, audio_url: '/stream/1' }),
      createTrack({ id: 2, audio_url: '/stream/2' }),
    ])

    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.audioPlaying()
    await flushPromises()

    // Prefetch не должен вернуть прослушанный трек 1 в очередь.
    expect(player.queue.map((track) => track.id)).toEqual([2])

    player.audioEnded()
    expect(player.currentTrack?.id).toBe(2)
  })

  it('playPrevious returns to the previously played track outside the context', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    // Контекст пуст (ручная очередь): трек 7 играл раньше, сейчас играет 8.
    player.playTrack(createTrack({ id: 7, audio_url: '/stream/7' }))
    player.audioPlaying()
    player.playTrack(createTrack({ id: 8, audio_url: '/stream/8' }))

    player.playPrevious()

    expect(player.currentTrack?.id).toBe(7)
    expect(controller.load).toHaveBeenLastCalledWith('/stream/7')
  })

  it('playPrevious falls back to history after queue playback from a context head', () => {
    const player = usePlayerStore()
    const controller = createControllerMock()
    player.bindAudioController(controller)

    const list = [createTrack({ id: 1, audio_url: '/stream/1' })]
    player.playFromList(list[0] as Track, list)
    player.audioPlaying()

    // Из очереди (не из контекста) включается другой трек.
    player.playTrack(createTrack({ id: 9, audio_url: '/stream/9' }))

    // Назад по контексту некуда (голова) — должен вернуть трек 1 по истории.
    player.playPrevious()

    expect(player.currentTrack?.id).toBe(1)
    expect(controller.load).toHaveBeenLastCalledWith('/stream/1')
  })
})
