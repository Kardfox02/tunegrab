import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const baseTrack: Track = {
  id: 1,
  youtube_id: 'yt-1',
  title: 'Song',
  author: 'Artist',
  duration: 180,
  status: 'done',
  progress: 100,
  audio_url: '/stream/1',
  cover_url: null,
  file_size: 1024,
  created_at: '2026-01-01T00:00:00Z',
}

function mountRow(props: Record<string, unknown> = {}) {
  setActivePinia(createPinia())
  return mount(TrackRow, {
    props: {
      track: baseTrack,
      isDeleting: false,
      deleteErrorMessage: null,
      draggable: true,
      ...props,
    },
  })
}

type GripElement = Element & {
  hasPointerCapture?: (pointerId: number) => boolean
  releasePointerCapture?: (pointerId: number) => void
}

function firePointerDown(element: Element, captures: boolean): void {
  const event = new Event('pointerdown', { bubbles: true }) as Event & {
    pointerId: number
    isPrimary: boolean
  }
  Object.assign(event, { pointerId: 1, isPrimary: true })

  const target = element as GripElement
  if (captures) {
    target.hasPointerCapture = vi.fn(() => true)
    target.releasePointerCapture = vi.fn()
  }

  element.dispatchEvent(event)
}

describe('TrackRow grip (touch drag)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('emits dragStart on pointerdown and releases implicit pointer capture', () => {
    const wrapper = mountRow()
    const grip = wrapper.get('.track-row__grip') as unknown as { element: GripElement }

    firePointerDown(grip.element, true)

    expect(wrapper.emitted('dragStart')).toHaveLength(1)
    expect(grip.element.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('does not attach releasePointerCapture expectations when nothing is captured', () => {
    const wrapper = mountRow()
    const grip = wrapper.get('.track-row__grip') as unknown as { element: GripElement }

    firePointerDown(grip.element, false)

    expect(wrapper.emitted('dragStart')).toHaveLength(1)
    // hasPointerCapture вернул false (jsdom не задаёт capture) — release не звался.
    expect(grip.element.releasePointerCapture).toBeUndefined()
  })

  it('stops synthesized clicks at the grip so dragging does not start playback', () => {
    const wrapper = mountRow()
    const clickSpy = vi.fn()
    wrapper.vm.$el.addEventListener('click', clickSpy)

    wrapper.get('.track-row__grip').trigger('click')

    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('renders no grip at all when not draggable', () => {
    const wrapper = mountRow({ draggable: false })

    expect(wrapper.find('.track-row__grip').exists()).toBe(false)
  })

  it('keeps row highlighting deterministic: drop-target resolves via data attribute hit-test', () => {
    // Реплика hit-test-контракта PlaylistView: elementFromPoint → ближайший
    // li[data-drag-index]. Атрибут обязан оказаться на корневом <li> строки —
    // проверяем интеграцию TrackList → TrackRow (атрибут задаёт TrackList).
    const pinia = createPinia()
    setActivePinia(pinia)
    const wrapper = mount(TrackList, {
      props: {
        tracks: [baseTrack],
        deletingIds: [],
        deleteError: null,
        draggable: true,
        dragIndex: null,
        dropIndex: null,
      },
    })

    const attr = wrapper.get('li[data-drag-index]').attributes('data-drag-index')
    expect(attr).toBe('0')
  })
})
