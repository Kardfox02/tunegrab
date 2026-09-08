import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

import { usePlayerStore } from '@/stores/player.store'
import PlayerBar from '../PlayerBar.vue'
import type { Track } from '@/types/track'

vi.mock('@/services/cover-color.service', () => ({
  resolveCoverColor: vi.fn(() => null),
  getCoverAccentColor: vi.fn(async () => null),
  getCachedCoverColor: vi.fn(() => null),
}))

vi.mock('@/api/likes-api', () => ({
  fetchLikes: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 }),
  addLike: vi.fn().mockResolvedValue(undefined),
  removeLike: vi.fn().mockResolvedValue(undefined),
}))

import { addLike, removeLike } from '@/api/likes-api'
import { getCoverAccentColor } from '@/services/cover-color.service'

const mockedGetColor = vi.mocked(getCoverAccentColor)
const mockedAdd = vi.mocked(addLike)
const mockedRemove = vi.mocked(removeLike)

const mediaMocks: { play: Mock; pause: Mock; load: Mock } = {
  play: vi.fn(),
  pause: vi.fn(),
  load: vi.fn(),
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

describe('PlayerBar', () => {
  beforeEach(() => {
    mediaMocks.play = vi.fn().mockResolvedValue(undefined)
    mediaMocks.pause = vi.fn()
    mediaMocks.load = vi.fn()
    window.HTMLMediaElement.prototype.play = mediaMocks.play as never
    window.HTMLMediaElement.prototype.pause = mediaMocks.pause as never
    window.HTMLMediaElement.prototype.load = mediaMocks.load as never
    window.localStorage.removeItem('tunegrab.player-volume')
    mockedAdd.mockClear()
    mockedRemove.mockClear()
    mockedAdd.mockResolvedValue(undefined)
    mockedRemove.mockResolvedValue(undefined)
  })

  function mountBar() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(PlayerBar, { global: { plugins: [pinia] } })
    const player = usePlayerStore()
    const audio = wrapper.get('audio').element as HTMLAudioElement

    return { wrapper, player, audio }
  }

  it('binds the audio controller on mount and executes store commands', () => {
    const { player, audio } = mountBar()

    player.playTrack(createTrack())

    expect(audio.getAttribute('src')).toBe('/stream/1')
    expect(mediaMocks.load).toHaveBeenCalledOnce()
    expect(mediaMocks.play).toHaveBeenCalledOnce()

    player.seek(30)
    expect(audio.currentTime).toBe(30)

    player.setVolume(0.4)
    expect(audio.volume).toBeCloseTo(0.4)
  })

  it('unbinds the controller on unmount', () => {
    const { wrapper, player } = mountBar()
    wrapper.unmount()

    player.playTrack(createTrack())

    expect(mediaMocks.play).not.toHaveBeenCalled()
  })

  it('syncs store state from native audio events', () => {
    const { player, audio } = mountBar()
    player.playTrack(createTrack())

    audio.currentTime = 42
    audio.dispatchEvent(new Event('timeupdate'))
    expect(player.position).toBe(42)

    Object.defineProperty(audio, 'duration', { value: 321 })
    audio.dispatchEvent(new Event('loadedmetadata'))
    expect(player.duration).toBe(321)

    audio.dispatchEvent(new Event('stalled'))
    expect(player.isLoading).toBe(true)

    audio.dispatchEvent(new Event('canplay'))
    expect(player.isLoading).toBe(false)

    audio.dispatchEvent(new Event('play'))
    expect(player.isPlaying).toBe(true)

    audio.dispatchEvent(new Event('pause'))
    expect(player.isPlaying).toBe(false)
  })

  it('schedules stream recovery instead of failing on audio error', () => {
    vi.useFakeTimers()
    try {
      const { player, audio } = mountBar()
      player.playTrack(createTrack())
      player.audioPlaying()
      const loadsBefore = mediaMocks.load.mock.calls.length

      audio.dispatchEvent(new Event('error'))
      expect(player.playbackError).toBeNull()

      vi.advanceTimersByTime(1000)

      expect(mediaMocks.load.mock.calls.length).toBe(loadsBefore + 1)
      expect(mediaMocks.play).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('advances to the queued track on ended', () => {
    const { player, audio } = mountBar()
    player.playTrack(createTrack({ id: 1, audio_url: '/stream/1' }))
    player.addToQueue(createTrack({ id: 2, audio_url: '/stream/2', title: 'Second' }))

    audio.dispatchEvent(new Event('ended'))

    expect(player.currentTrack?.id).toBe(2)
    expect(audio.getAttribute('src')).toBe('/stream/2')
    expect(mediaMocks.play).toHaveBeenCalledTimes(2)
  })

  it('downgrades a rejected play call to paused state', async () => {
    mediaMocks.play.mockRejectedValueOnce(new Error('NotAllowedError'))
    const { player } = mountBar()

    player.playTrack(createTrack())
    await flushPromises()

    expect(player.isPlaying).toBe(false)
    expect(player.playbackError).toBeNull()
  })

  it('renders an empty state with disabled controls until a track is selected', async () => {
    const { wrapper, player } = mountBar()

    expect(wrapper.get('.player-bar__title').text()).toBe('Трек не выбран')
    const playButton = wrapper.get('.player-bar__play')
    expect((playButton.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('.player-bar__like').exists()).toBe(false)

    player.playTrack(createTrack())
    await flushPromises()

    expect(wrapper.get('.player-bar__title').text()).toBe('Song')
    expect((playButton.element as HTMLButtonElement).disabled).toBe(false)
    expect(wrapper.find('.player-bar__like').exists()).toBe(true)
  })

  it('toggles the like of the current track from the player heart', async () => {
    const { wrapper, player } = mountBar()
    player.playTrack(createTrack())
    await flushPromises()

    const heart = wrapper.get('.player-bar__like')
    expect(heart.classes()).not.toContain('player-bar__like--liked')

    await heart.trigger('click')
    await flushPromises()

    expect(mockedAdd).toHaveBeenCalledWith(1)
    expect(heart.classes()).toContain('player-bar__like--liked')
    expect(heart.attributes('aria-pressed')).toBe('true')

    await heart.trigger('click')
    await flushPromises()

    expect(mockedRemove).toHaveBeenCalledWith(1)
    expect(heart.classes()).not.toContain('player-bar__like--liked')
  })

  it('toggles playback from the play button and updates the label', async () => {
    const { wrapper, player, audio } = mountBar()
    player.playTrack(createTrack())
    await flushPromises()

    const playButton = wrapper.get('.player-bar__play')
    await playButton.trigger('click')
    expect(mediaMocks.play).toHaveBeenCalledTimes(2)

    audio.dispatchEvent(new Event('play'))
    await flushPromises()

    expect(playButton.attributes('aria-label')).toBe('Пауза')

    await playButton.trigger('click')
    expect(mediaMocks.pause).toHaveBeenCalledOnce()
  })

  it('seeks from the slider input', async () => {
    const { wrapper, player, audio } = mountBar()
    player.playTrack(createTrack())
    await flushPromises()

    const slider = wrapper.get('.player-bar__seek .player-bar__slider')
    await slider.setValue(45)

    expect(player.position).toBe(45)
    expect(audio.currentTime).toBe(45)
  })

  it('exposes the cover accent as a css variable and drops it on reset', async () => {
    const { wrapper, player } = mountBar()
    mockedGetColor.mockResolvedValue('hsl(210 80% 60%)')

    player.playTrack(createTrack({ cover_url: '/covers/red.jpg' }))
    await flushPromises()

    const bar = wrapper.get('.player-bar')
    expect(bar.attributes('style')).toContain('--track-accent: hsl(210 80% 60%)')

    // Смена трека без цвета → переменная уходит, панель возвращается к дефолту.
    player.playTrack(createTrack({ id: 2, cover_url: null }))
    await flushPromises()
    expect(wrapper.get('.player-bar').attributes('style')).not.toContain('--track-accent')

    // У трека с обложкой, у которой нет цвета, переменной тоже нет.
    mockedGetColor.mockResolvedValue(null)
    player.playTrack(createTrack({ id: 3, cover_url: '/covers/no-color.jpg' }))
    await flushPromises()
    expect(wrapper.get('.player-bar').attributes('style')).not.toContain('--track-accent')

    player.reset()
    await flushPromises()
    expect(player.trackAccent).toBeNull()
  })
})
