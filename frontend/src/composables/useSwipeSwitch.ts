import { computed, ref } from 'vue'

export type SwipeDirection = 'left' | 'right'

export interface UseSwipeSwitchOptions {
  /** |dx| ≥ длина × ratio → переключение; ниже — пружинный возврат. */
  thresholdRatio?: number
  getLength: () => number
  onSwipe: (direction: SwipeDirection) => void
  /** Цели вроде кнопок/слайдеров не должны начинать перетаскивание. */
  shouldIgnoreTarget?: (target: EventTarget | null) => boolean
}

export interface UseSwipeSwitchResult {
  isDragging: import('vue').Ref<boolean>
  offsetX: import('vue').Ref<number>
  dragStyle: import('vue').ComputedRef<Record<string, string>>
  onPointerDown: (event: PointerEvent) => void
  onPointerMove: (event: PointerEvent) => void
  onPointerUp: (event: PointerEvent) => void
}

export function useSwipeSwitch(options: UseSwipeSwitchOptions): UseSwipeSwitchResult {
  const thresholdRatio = options.thresholdRatio ?? 0.25

  const isDragging = ref(false)
  const offsetX = ref(0)
  let startX = 0
  let startY = 0
  let activePointerId: number | null = null

  const dragStyle = computed<Record<string, string>>(() => {
    if (!isDragging.value) {
      return {} as Record<string, string>
    }
    const drift = Math.min(0.5, Math.abs(offsetX.value) / 400)
    return {
      transform: `translateX(${offsetX.value}px)`,
      opacity: String(1 - drift),
    }
  })

  function onPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch' || isDragging.value) {
      return
    }
    if (options.shouldIgnoreTarget?.(event.target)) {
      return
    }
    const target = event.currentTarget
    if (target instanceof HTMLElement) {
      try {
        target.setPointerCapture(event.pointerId)
      } catch {
        // Захват не критичен — jsdom и некоторые среды его не поддерживают.
      }
    }

    isDragging.value = true
    activePointerId = event.pointerId
    startX = event.clientX
    startY = event.clientY
    offsetX.value = 0
  }

  function onPointerMove(event: PointerEvent): void {
    if (!isDragging.value || event.pointerId !== activePointerId) {
      return
    }
    offsetX.value = event.clientX - startX
  }

  function onPointerUp(event: PointerEvent): void {
    if (!isDragging.value || event.pointerId !== activePointerId) {
      return
    }

    const length = options.getLength()
    const threshold = length > 0 ? length * thresholdRatio : Number.POSITIVE_INFINITY
    const drift = offsetX.value
    const driftY = event.clientY - startY

    isDragging.value = false
    activePointerId = null
    offsetX.value = 0

    // Вертикальное движение доминирует — это скролл страницы, не свайп.
    if (Math.abs(driftY) > Math.abs(drift)) {
      return
    }

    if (Math.abs(drift) >= threshold) {
      options.onSwipe(drift < 0 ? 'left' : 'right')
    }
  }

  return {
    isDragging,
    offsetX,
    dragStyle,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
