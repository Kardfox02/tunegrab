<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import TrackRow from './TrackRow.vue'
import type { Track } from '@/types/track'

const props = withDefaults(
  defineProps<{
    tracks: Track[]
    // Значения по умолчанию избавляют вызывающие стороны от костыля
    // NO_DELETING_IDS: листы без удаления просто не передают проп.
    deletingIds?: number[]
    deleteError?: { id: number; message: string } | null
    progressById?: Map<number, Track> | null
    currentTrackId?: number | null
    isPlaying?: boolean
    likedTrackIds?: Set<number>
    togglingLikeIds?: Set<number>
    showAddToPlaylist?: boolean
    removeIcon?: 'trash' | 'close'
    draggable?: boolean
    dragIndex?: number | null
    dropIndex?: number | null
  }>(),
  { deletingIds: () => [], deleteError: null },
)

const emit = defineEmits<{
  play: [track: Track, index: number]
  remove: [track: Track, index: number]
  toggleLike: [track: Track]
  addToPlaylist: [track: Track]
  dragStart: [index: number]
  dragEnd: []
}>()

// Set для O(1)-проверки на строку: includes был бы O(N×M) на каждый рендер.
const deletingIdSet = computed(() => new Set(props.deletingIds))

// ── Окно-виртуализация большого списка (zero-dep) ─────────────────────────
// Библиотека растёт бесконечно (серверная догрузка партиями): DOM из сотен
// <li> × ~30 узлов трогает TTI и скролл. Рендерится видимая полоса строк
// ± overscan, сверху/снизу — распорки с накопленной высотой. Высоты строк
// кэшируются по id и уточняются фактическими измерениями. Небольшие списки
// (плейлисты, «Любимое») рендерятся целиком обычным потоком.

const PLAIN_RENDER_LIMIT = 60
// Стартовая оценка высоты строки (px) — уточняется измерениями.
const DEFAULT_ROW_HEIGHT = 72
// Запас вокруг видимой полосы (px).
const OVERSCAN_PX = 800

const isWindowed = computed(() => props.tracks.length > PLAIN_RENDER_LIMIT)

const listElement = ref<HTMLElement | null>(null)
// trackId → измеренная высота строки (px). Повторные проходы не меряют заново.
const rowHeights = ref(new Map<number, number>())
// Реестр DOM-узлов отрендеренных строк — рефы не реактивны, читаются императивно.
const rowElements = new Map<number, HTMLElement>()

// Видимое окно [start, end) в индексах tracks.
const windowStart = ref(0)
const windowEnd = ref(0)
// Межстрочный зазор списка (максимум с --space-3 = 0.75rem; уточняется в recalc).
const rowGapPx = ref(12)

/**
 * Накопленные смещения строк с учётом межстрочного зазора: offsets[i] —
 * расстояние от верха списка до верха строки i; offsets[n] — полная высота.
 */
const rowOffsets = computed<number[]>(() => {
  const heights = rowHeights.value
  const gap = rowGapPx.value
  const count = props.tracks.length
  const offsets: number[] = [0]
  let acc = 0
  let index = 0
  for (const track of props.tracks) {
    acc += heights.get(track.id) ?? DEFAULT_ROW_HEIGHT
    offsets.push(acc)
    if (index < count - 1) {
      acc += gap
    }
    index += 1
  }
  return offsets
})

const totalHeight = computed(() => rowOffsets.value[rowOffsets.value.length - 1] ?? 0)

const windowTracks = computed(() => props.tracks.slice(windowStart.value, windowEnd.value))
const visibleTracks = computed(() => (isWindowed.value ? windowTracks.value : props.tracks))
const visibleRows = computed(() =>
  visibleTracks.value.map((track, i) => ({
    track,
    index: i + (isWindowed.value ? windowStart.value : 0),
  })),
)

// Распорки участвуют в flex-колонке с gap: боковые зазоры компенсируются,
// чтобы суммарная высота совпадала с естественной раскладкой.
const spacerTop = computed(() => {
  if (!isWindowed.value || windowStart.value === 0) {
    return 0
  }
  return Math.max(0, (rowOffsets.value[windowStart.value] ?? 0) - rowGapPx.value)
})
const spacerBottom = computed(() => {
  if (!isWindowed.value || windowEnd.value >= props.tracks.length) {
    return 0
  }
  return Math.max(0, totalHeight.value - (rowOffsets.value[windowEnd.value] ?? totalHeight.value))
})

/** Первый ряд, нижняя граница которого превышает offset (бинарный поиск). */
function indexForOffset(offset: number): number {
  const offsets = rowOffsets.value
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if ((offsets[mid + 1] ?? Number.POSITIVE_INFINITY) <= offset) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

function measureRowGap(): void {
  const listEl = listElement.value
  if (!listEl) {
    return
  }
  const parsed = Number.parseFloat(window.getComputedStyle(listEl).rowGap)
  if (Number.isFinite(parsed) && parsed >= 0) {
    rowGapPx.value = parsed
  }
}

function recalcWindow(): void {
  if (!isWindowed.value) {
    return
  }
  const listEl = listElement.value
  if (!listEl) {
    return
  }

  measureRowGap()
  const rect = listEl.getBoundingClientRect()
  const top = Math.max(0, -rect.top)
  const bottom = top + window.innerHeight

  windowStart.value = Math.max(0, indexForOffset(top - OVERSCAN_PX))
  windowEnd.value = Math.min(props.tracks.length, indexForOffset(bottom + OVERSCAN_PX) + 1)

  void nextTick(measureRenderedRows)
}

/** Уточняет кэш высот фактическими высотами отрендеренных строк. */
function measureRenderedRows(): void {
  if (!isWindowed.value) {
    return
  }
  const nextHeights = new Map(rowHeights.value)
  let changed = false
  for (const [trackId, el] of rowElements) {
    const measured = Math.round(el.getBoundingClientRect().height)
    if (measured > 0 && nextHeights.get(trackId) !== measured) {
      nextHeights.set(trackId, measured)
      changed = true
    }
  }
  if (changed) {
    rowHeights.value = nextHeights
    recalcWindow()
  }
}

let recalcRaf: number | null = null

function scheduleRecalc(): void {
  if (recalcRaf !== null) {
    return
  }
  recalcRaf = window.requestAnimationFrame(() => {
    recalcRaf = null
    recalcWindow()
  })
}

type RowRefBinding = Element | { $el?: unknown } | null

function setRowRef(trackId: number, el: RowRefBinding): void {
  const domEl = el instanceof HTMLElement ? el : (el as { $el?: HTMLElement } | null)?.$el
  if (domEl instanceof HTMLElement) {
    rowElements.set(trackId, domEl)
  } else {
    rowElements.delete(trackId)
  }
}

// Содержимое может смениться при равной длине (сортировка, reorder, поиск).
watch(() => props.tracks, scheduleRecalc)
watch(isWindowed, () => {
  rowElements.clear()
  scheduleRecalc()
})

onMounted(() => {
  window.addEventListener('scroll', scheduleRecalc, { passive: true })
  window.addEventListener('resize', scheduleRecalc)
  recalcWindow()
})

onBeforeUnmount(() => {
  if (recalcRaf !== null) {
    window.cancelAnimationFrame(recalcRaf)
    recalcRaf = null
  }
  window.removeEventListener('scroll', scheduleRecalc)
  window.removeEventListener('resize', scheduleRecalc)
  rowElements.clear()
})
</script>

<template>
  <ul ref="listElement" class="track-list">
    <li
      v-if="spacerTop > 0"
      class="track-list__spacer"
      :style="{ height: spacerTop + 'px' }"
      aria-hidden="true"
    ></li>
    <TrackRow
      v-for="row in visibleRows"
      :key="row.track.id"
      :ref="(el) => setRowRef(row.track.id, el)"
      :track="row.track"
      :is-deleting="deletingIdSet.has(row.track.id)"
      :delete-error-message="deleteError?.id === row.track.id ? deleteError.message : null"
      :active-download="progressById?.get(row.track.id) ?? null"
      :is-current="currentTrackId === row.track.id"
      :is-playing="isPlaying"
      :is-liked="likedTrackIds?.has(row.track.id) ?? false"
      :is-toggling-like="togglingLikeIds?.has(row.track.id) ?? false"
      :show-add-to-playlist="showAddToPlaylist"
      :remove-icon="removeIcon"
      :draggable="draggable"
      :is-dragging="dragIndex === row.index"
      :is-drop-target="dropIndex === row.index && dragIndex !== row.index"
      :data-drag-index="row.index"
      @play="emit('play', row.track, row.index)"
      @remove="emit('remove', row.track, row.index)"
      @toggle-like="emit('toggleLike', row.track)"
      @add-to-playlist="emit('addToPlaylist', row.track)"
      @drag-start="emit('dragStart', row.index)"
      @drag-end="emit('dragEnd')"
    />
    <li
      v-if="spacerBottom > 0"
      class="track-list__spacer"
      :style="{ height: spacerBottom + 'px' }"
      aria-hidden="true"
    ></li>
  </ul>
</template>
