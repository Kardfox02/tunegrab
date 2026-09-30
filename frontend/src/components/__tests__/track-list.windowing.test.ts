import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import TrackList from '../TrackList.vue'
import TrackRow from '../TrackRow.vue'
import type { Track } from '@/types/track'

vi.mock('@/services/cover-color.service', () => ({
  resolveCoverColor: vi.fn(() => null),
  getCoverAccentColor: vi.fn(async () => null),
  getCachedCoverColor: vi.fn(() => null),
}))

vi.mock('@/composables/useMediaQuery', () => ({
  useIsDesktop: () => ({ value: false }),
}))
function createTrack(id: number): Track {
  return {
    id,
    youtube_id: `yt-${id}`,
    title: `Song ${id}`,
    author: 'Artist',
    duration: 180,
    status: 'done',
    progress: 100,
    audio_url: `/stream/${id}`,
    cover_url: null,
    file_size: 1024,
    created_at: '2026-01-01T00:00:00Z',
  }
}

describe('TrackList windowing', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    wrapper = null
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  function mountList(tracks: Track[], extraProps: Record<string, unknown> = {}): VueWrapper {
    setActivePinia(createPinia())
    const mounted = mount(
      TrackList,
      {
        props: {
          tracks,
          deletingIds: [],
          deleteError: null,
          ...extraProps,
        },
        attachTo: document.body,
      },
    ) as VueWrapper
    wrapper = mounted
    return mounted
  }

  it('renders every row for small lists (plain mode, no spacers)', () => {
    const tracks = Array.from({ length: 10 }, (_, i) => createTrack(i + 1))
    const mounted = mountList(tracks)

    expect(mounted.findAllComponents(TrackRow)).toHaveLength(10)
    expect(mounted.find('.track-list__spacer').exists()).toBe(false)
  })

  it('renders a slice with spacers for large lists and keeps original indices', async () => {
    const tracks = Array.from({ length: 200 }, (_, i) => createTrack(i + 1))
    const mounted = mountList(tracks)
    // Окно вычисляется в onMounted — патч попадает в DOM после nextTick.
    await nextTick()

    const rendered = mounted.findAllComponents(TrackRow)
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(tracks.length)

    // Распорки держат высоту неотрендеренных частей.
    const spacers = mounted.findAll('.track-list__spacer')
    expect(spacers.length).toBeGreaterThanOrEqual(1)

    // data-drag-index обязателен для hit-test drag&drop: у первого ряда
    // оригинальный индекс 0 даже в оконном режиме.
    expect(rendered[0]?.attributes('data-drag-index')).toBe('0')

    // Эмиссия play должна передавать оригинальный индекс списка.
    const playButton = rendered[0]?.find('.track-row__cover-play')
    await playButton?.trigger('click')
    expect(mounted.emitted('play')?.[0]?.[1]).toBe(0)
  })
})
