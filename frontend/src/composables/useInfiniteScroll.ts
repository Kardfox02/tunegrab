import { computed, onMounted, onUnmounted, watch, type Ref } from 'vue'

export interface UseInfiniteScrollOptions {
  /** Элемент-сентинел в конце списка; пересечение = пора догружать. */
  target: Ref<Element | null>
  /** Вызывается при пересечении сентинела (фильтр активности — на вызывающей стороне). */
  onIntersect: () => void
  /** Пока true, наблюдатель не срабатывает. */
  isDisabled: () => boolean
  /** Корневой скролл-контейнер; по умолчанию viewport. */
  root?: Ref<Element | null>
}

export function useInfiniteScroll(options: UseInfiniteScrollOptions): void {
  let observer: IntersectionObserver | null = null

  function shouldLoad(): boolean {
    return !options.isDisabled()
  }

  function observeTarget(): void {
    if (!observer) {
      return
    }
    // Сентинел появляется и исчезает динамически (v-if по hasMore и веткам
    // состояний), поэтому закрепление повторяется при каждой смене цели.
    observer.disconnect()
    if (options.target.value) {
      observer.observe(options.target.value)
    }
  }

  function disconnect(): void {
    observer?.disconnect()
    observer = null
  }

  // Сентинел мог остаться пересекающимся на момент, когда isDisabled() был
  // true (событие пересечения пришло во время загрузки и было отброшено).
  // Проверяем геометрию вручную: если он действительно в вьюпорте — вызываем
  // onIntersect, иначе список перестаёт догружаться до пересборки DOM.
  function checkStillIntersecting(): void {
    const target = options.target.value
    if (!target || observer === null || !shouldLoad()) {
      return
    }
    const bounds = target.getBoundingClientRect()
    if (bounds.top < window.innerHeight + 200 && bounds.bottom > -200) {
      options.onIntersect()
    }
  }

  // Отслеживаем выход из блокировки (реактивные зависимости isDisabled
  // читаются внутри watcher'а): в момент разблокировки сентинел мог всё ещё
  // физически находиться в вьюпорте — IntersectionObserver не пришлёт новое
  // событие, и список навсегда остановился бы. Ручная проверка геометрии
  // закрывает эту гонку догрузки.
  const isDisabledTrigger = computed(() => options.isDisabled())
  watch(
    isDisabledTrigger,
    (isNowDisabled, wasPreviouslyDisabled) => {
      if (wasPreviouslyDisabled && !isNowDisabled) {
        checkStillIntersecting()
      }
    },
  )

  watch(() => options.target.value, observeTarget)

  onMounted(() => {
    if (typeof IntersectionObserver !== 'function') {
      // Среда без IO (старые браузеры, jsdom): догрузка недоступна,
      // пользовательский сценарий деградирует, но приложение работает.
      return
    }

    observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && shouldLoad()) {
          options.onIntersect()
        }
      },
      { root: options.root?.value ?? null, rootMargin: '200px' },
    )

    observeTarget()
  })

  onUnmounted(disconnect)
}
