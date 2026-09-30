import { onScopeDispose, ref } from 'vue'

export interface PlaylistDragReorderOptions {
  /** Коммит перестановки: вызывается после валидации границ. */
  commit: (from: number, to: number) => void
}

const AUTO_SCROLL_EDGE = 80
const AUTO_SCROLL_MAX_SPEED = 14

/**
 * Drag&drop-движок перестановки плейлиста: pointer-жест по грипу строки,
 * deterministic hit-test (elementFromPoint один раз на кадр) и автоскролл
 * у верхней/нижней кромки. View остаётся только с коммитом перестановки.
 */
export function usePlaylistDragReorder(options: PlaylistDragReorderOptions) {
  const dragIndex = ref<number | null>(null)
  const dropIndex = ref<number | null>(null)

  let autoScrollPointerX = 0
  let autoScrollPointerY = 0
  // Жест начинается с pointerdown, но реальные координаты приходят только с
  // первым pointermove. Пока их нет — автоскролл «спит»: нулевая координата
  // ложится в верхнюю кромку и давал бы рывок списка вверх в начале drag.
  let autoScrollHasSample = false
  let autoScrollRaf: number | null = null

  function autoScrollStep(): void {
    if (dragIndex.value === null) {
      autoScrollRaf = null
      return
    }

    if (autoScrollHasSample) {
      // Deterministic hit-test: у тач-указателей события не ретаргетятся, а
      // pointerenter соседних строк блокируется неявным pointer capture —
      // поэтому «над какой строкой палец» узнаём напрямую, по координатам.
      // Расчёт — один на кадр (здесь), а не на каждый pointermove.
      const target = document.elementFromPoint(autoScrollPointerX, autoScrollPointerY)
      const indexAttr = target?.closest('li[data-drag-index]')?.getAttribute('data-drag-index')
      if (indexAttr !== null && indexAttr !== undefined) {
        const index = Number(indexAttr)
        if (Number.isFinite(index)) {
          setDropIndex(index)
        }
      }

      let speed = 0
      const edgeBottom = window.innerHeight - AUTO_SCROLL_EDGE
      if (autoScrollPointerY < AUTO_SCROLL_EDGE) {
        // Чем ближе к краю — тем быстрее (1 у границы зоны, MAX у самого края).
        speed = -Math.round(AUTO_SCROLL_MAX_SPEED * (1 - autoScrollPointerY / AUTO_SCROLL_EDGE) + 1)
      } else if (autoScrollPointerY > edgeBottom) {
        const depth = (autoScrollPointerY - edgeBottom) / AUTO_SCROLL_EDGE
        speed = Math.round(AUTO_SCROLL_MAX_SPEED * depth + 1)
      }

      if (speed !== 0) {
        window.scrollBy(0, speed)
      }
    }

    autoScrollRaf = window.requestAnimationFrame(autoScrollStep)
  }

  function onDragPointerMove(event: PointerEvent): void {
    // На каждый pointermove только координаты; вся работа (hit-test, автоскролл)
    // выполняется в RAF-цикле — не чаще одного раза на кадр.
    autoScrollPointerX = event.clientX
    autoScrollPointerY = event.clientY
    autoScrollHasSample = true
  }

  function startAutoScrollTracking(): void {
    autoScrollPointerX = 0
    autoScrollPointerY = 0
    autoScrollHasSample = false
    document.addEventListener('pointermove', onDragPointerMove)
    document.addEventListener('pointercancel', onDragPointerCancel)
    if (autoScrollRaf === null) {
      autoScrollRaf = window.requestAnimationFrame(autoScrollStep)
    }
  }

  function stopAutoScrollTracking(): void {
    document.removeEventListener('pointermove', onDragPointerMove)
    document.removeEventListener('pointercancel', onDragPointerCancel)
    if (autoScrollRaf !== null) {
      window.cancelAnimationFrame(autoScrollRaf)
      autoScrollRaf = null
    }
  }

  // Системная отмена жеста (входящий звонок, системный свайп): pointerup не
  // приходит, и drag Index/RAF-цикл зависали до ухода со страницы.
  function onDragPointerCancel(): void {
    dragIndex.value = null
    dropIndex.value = null
    stopAutoScrollTracking()
  }

  function setDropIndex(index: number): void {
    if (dragIndex.value === null || dragIndex.value === index) {
      return
    }
    dropIndex.value = index
  }

  function onRowDragStart(index: number): void {
    dragIndex.value = index
    startAutoScrollTracking()
  }

  function onRowDragEnd(): void {
    stopAutoScrollTracking()
    const from = dragIndex.value
    const to = dropIndex.value
    dragIndex.value = null
    dropIndex.value = null

    if (from === null || to === null || from === to) {
      return
    }

    options.commit(from, to)
  }

  onScopeDispose(stopAutoScrollTracking)

  return {
    dragIndex,
    dropIndex,
    onRowDragStart,
    onRowDragEnd,
  }
}
