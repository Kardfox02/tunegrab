import { onScopeDispose, watch, type WatchSource } from 'vue'

/**
 * Watch с дебаунсом: callback вызывается через delayMs после последнего
 * изменения источника; таймер снимается автоматически при разрушении scope.
 * Замена рукописных `let timer + clearTimeout` в компонентах.
 */
export function useDebouncedWatch(
  source: WatchSource<unknown>,
  callback: () => void,
  delayMs: number,
): void {
  let timer: number | null = null

  watch(source, () => {
    if (timer !== null) {
      window.clearTimeout(timer)
    }
    timer = window.setTimeout(() => {
      timer = null
      callback()
    }, delayMs)
  })

  onScopeDispose(() => {
    if (timer !== null) {
      window.clearTimeout(timer)
      timer = null
    }
  })
}
