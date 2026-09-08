import { describe, expect, it, vi } from 'vitest'

import { useSwipeSwitch, type SwipeDirection } from '@/composables/useSwipeSwitch'

interface PointerInit {
  pointerId: number
  pointerType: string
  clientX: number
  clientY: number
}

function createPointerEvent(init: PointerInit): PointerEvent {
  return {
    pointerId: init.pointerId,
    pointerType: init.pointerType,
    clientX: init.clientX,
    clientY: init.clientY,
    currentTarget: null,
    target: null,
  } as unknown as PointerEvent
}

function createHarness() {
  const onSwipe = vi.fn<(direction: SwipeDirection) => void>()
  const swipe = useSwipeSwitch({
    getLength: () => 400,
    onSwipe,
  })
  return { swipe, onSwipe }
}

describe('useSwipeSwitch', () => {
  it('triggers onSwipe when horizontal drift exceeds the threshold', () => {
    const { swipe, onSwipe } = createHarness()

    // |dx| = 120 > порога 100 (400 × 0.25), |dy| = 0.
    swipe.onPointerDown(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 }))
    swipe.onPointerMove(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 100 }))
    swipe.onPointerUp(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 80, clientY: 100 }))

    expect(onSwipe).toHaveBeenCalledWith('left')
  })

  it('ignores the gesture when vertical drift dominates (page scroll)', () => {
    const { swipe, onSwipe } = createHarness()

    // |dx| = 300 > порога 100, но |dy| = 350 больше — это вертикальный скролл.
    swipe.onPointerDown(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 }))
    swipe.onPointerMove(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 450 }))
    swipe.onPointerUp(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 0, clientY: 450 }))

    expect(onSwipe).not.toHaveBeenCalled()
    expect(swipe.isDragging.value).toBe(false)
  })

  it('still triggers when vertical drift is smaller than horizontal', () => {
    const { swipe, onSwipe } = createHarness()

    swipe.onPointerDown(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 200, clientY: 100 }))
    swipe.onPointerMove(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 130 }))
    swipe.onPointerUp(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 130 }))

    expect(onSwipe).toHaveBeenCalledWith('left')
  })

  it('ignores non-touch pointers', () => {
    const { swipe, onSwipe } = createHarness()

    swipe.onPointerDown(createPointerEvent({ pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100 }))

    expect(swipe.isDragging.value).toBe(false)
  })

  it('does not trigger below the threshold', () => {
    const { swipe, onSwipe } = createHarness()

    swipe.onPointerDown(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 }))
    swipe.onPointerMove(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 100 }))
    swipe.onPointerUp(createPointerEvent({ pointerId: 1, pointerType: 'touch', clientX: 60, clientY: 100 }))

    expect(onSwipe).not.toHaveBeenCalled()
  })
})
