import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useMediaQuery(query: string): Ref<boolean> {
  const matches = ref(false)
  let mediaQuery: MediaQueryList | null = null

  const update = (event: MediaQueryList | MediaQueryListEvent): void => {
    matches.value = event.matches
  }

  onMounted(() => {
    if (typeof window.matchMedia !== 'function') {
      return
    }
    mediaQuery = window.matchMedia(query)
    update(mediaQuery)
    mediaQuery.addEventListener('change', update)
  })

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', update)
  })

  return matches
}

export function useIsDesktop(): Ref<boolean> {
  return useMediaQuery('(hover: hover) and (pointer: fine)')
}
