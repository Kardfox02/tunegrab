<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import AppIcon from './AppIcon.vue'
import CoverPlaceholder from './CoverPlaceholder.vue'
import DownloadProgress from './DownloadProgress.vue'
import { useIsDesktop } from '@/composables/useMediaQuery'
import { getCachedCoverColor, getCoverAccentColor } from '@/services/cover-color.service'
import { usePlayerStore } from '@/stores/player.store'
import type { Track } from '@/types/track'
import { TRACK_STATUS_LABELS, TRACK_STATUS_TONES } from '@/types/track'
import { formatDuration } from '@/utils/format'

const props = withDefaults(
  defineProps<{
    track: Track
    isDeleting: boolean
    deleteErrorMessage: string | null
    activeDownload?: Track | null
    isCurrent?: boolean
    isPlaying?: boolean
    isLiked?: boolean
    isTogglingLike?: boolean
    draggable?: boolean
    isDragging?: boolean
    isDropTarget?: boolean
    showAddToPlaylist?: boolean
    removeIcon?: 'trash' | 'close'
  }>(),
  { removeIcon: 'trash' },
)

const emit = defineEmits<{ play: []; remove: []; toggleLike: []; addToPlaylist: []; dragStart: []; dragEnd: [] }>()

const player = usePlayerStore()

const isCurrent = computed(() => props.isCurrent === true)
const isCurrentPlaying = computed(() => isCurrent.value && props.isPlaying === true)

// Акцент из цвета обложки своей строки: красит hover/current-состояния.
// Извлечение ленивое: резерв простой гидратации из кэша при маунте, но
// тяжёлая загрузка Image запускается только событием load у ВИДИМОЙ картинки
// (offscreen-строки не качают обложки — сохраняется смысл loading="lazy").
const accent = ref<string | null>(null)
const accentBump = ref(0)

function onCoverLoaded(): void {
  void getCoverAccentColor(props.track.cover_url as string).then((color) => {
    if (color) {
      accent.value = color
      accentBump.value += 1
    }
  })
}

watch(
  () => props.track.cover_url,
  (coverUrl) => {
    accentBump.value += 1
    // Синхронная гидратация из кэша (без загрузки Image).
    accent.value = getCachedCoverColor(coverUrl ?? '') ?? null
  },
  { immediate: true },
)

const rowAccent = computed(() => {
  void accentBump.value
  return accent.value ?? 'var(--color-accent)'
})

const statusLabels = TRACK_STATUS_LABELS
const statusTones = TRACK_STATUS_TONES

const isPlayable = computed(() => props.track.status === 'done' && Boolean(props.track.audio_url))

const isDesktop = useIsDesktop()

const canStartPlayback = computed(() => isPlayable.value && !props.isDeleting)

const coverActionLabel = computed(() =>
  isCurrentPlaying.value ? `Пауза: ${props.track.title}` : `Воспроизвести: ${props.track.title}`,
)

const equalizerAccent = computed(() =>
  isCurrent.value ? (player.trackAccent ?? rowAccent.value) : null,
)

function handleRowClick(): void {
  if (!isDesktop.value) {
    emit('play')
  }
}

function handleRowDoubleClick(): void {
  if (isDesktop.value) {
    emit('play')
  }
}

const rowElement = ref<HTMLElement | null>(null)

// Pointer-based drag&drop: захват handle начинает перенос, отпускание кнопки —
// завершает. Window-listener активен только пока строка реально перетаскивается
// (isDragging): раньше каждая строка держала постоянный window-listener —
// N listeners на список срабатывали на любой клик по странице.
function onWindowPointerUp(): void {
  emit('dragEnd')
}

function onHandlePointerDown(event: PointerEvent): void {
  if (!props.draggable || !event.isPrimary) {
    return
  }
  // Touch: браузер неявно захватывает pointer источником pointerdown (грипом)
  // — тогда pointerenter соседних строк не срабатывает, dropIndex не
  // устанавливается и перестановка не происходит. Снимаем capture, чтобы
  // события hover-flow доходили до строк под пальцем.
  const handle = event.currentTarget
  if (handle instanceof HTMLElement && handle.hasPointerCapture?.(event.pointerId)) {
    handle.releasePointerCapture(event.pointerId)
  }
  event.preventDefault()
  emit('dragStart')
}

watch(
  () => props.isDragging === true,
  (isNowDragging, wasDragging) => {
    if (isNowDragging && !wasDragging) {
      window.addEventListener('pointerup', onWindowPointerUp)
    } else if (!isNowDragging && wasDragging) {
      window.removeEventListener('pointerup', onWindowPointerUp)
    }
  },
)

onUnmounted(() => {
  window.removeEventListener('pointerup', onWindowPointerUp)
})

defineExpose({ rowElement })

const durationLabel = computed(() => formatDuration(props.track.duration))
</script>

<template>
  <li
    ref="rowElement"
    class="track-row"
    :class="{
      'track-row--playable': canStartPlayback,
      'track-row--current': isCurrent,
      'track-row--draggable': draggable,
      'track-row--dragging': isDragging,
      'track-row--drop-target': isDropTarget,
    }"
    :style="{ '--track-accent': rowAccent, '--track-accent-eq': equalizerAccent ?? rowAccent }"
    @click="canStartPlayback && handleRowClick()"
    @dblclick="canStartPlayback && handleRowDoubleClick()"
  >
    <span
      v-if="draggable"
      class="track-row__grip"
      aria-hidden="true"
      @pointerdown="onHandlePointerDown"
      @click.stop
    >
      <AppIcon name="grip" />
    </span>

    <div class="track-row__cover" aria-hidden="true">
      <CoverPlaceholder :src="track.cover_url" @load="onCoverLoaded" />

      <span v-if="isCurrent" class="track-row__cover-overlay" aria-hidden="true"></span>

      <span v-if="isCurrent" class="track-row__equalizer" aria-hidden="true">
        <span class="track-row__equalizer-bar" :class="{ 'track-row__equalizer-bar--paused': !isPlaying }"></span>
        <span class="track-row__equalizer-bar track-row__equalizer-bar--2" :class="{ 'track-row__equalizer-bar--paused': !isPlaying }"></span>
        <span class="track-row__equalizer-bar track-row__equalizer-bar--3" :class="{ 'track-row__equalizer-bar--paused': !isPlaying }"></span>
        <span class="track-row__equalizer-bar track-row__equalizer-bar--4" :class="{ 'track-row__equalizer-bar--paused': !isPlaying }"></span>
        <span class="track-row__equalizer-bar track-row__equalizer-bar--5" :class="{ 'track-row__equalizer-bar--paused': !isPlaying }"></span>
      </span>

      <button
        v-else-if="canStartPlayback"
        class="track-row__cover-play"
        type="button"
        :aria-label="coverActionLabel"
        @click.stop="emit('play')"
        @dblclick.stop
      >
        <AppIcon name="play" class="track-row__action-icon" />
      </button>
    </div>

    <div class="track-row__info">
      <span class="track-row__title">{{ track.title }}</span>
      <span class="track-row__author">{{ track.author }}</span>
    </div>

    <div class="track-row__meta">
      <DownloadProgress
        v-if="activeDownload"
        class="track-row__progress"
        :status="activeDownload.status"
        :progress="activeDownload.progress"
      />
      <template v-else>
        <span class="track-row__duration">{{ durationLabel }}</span>
        <span class="status-badge" :class="`status-badge--${statusTones[track.status]}`">
          <span class="status-badge__dot" aria-hidden="true"></span>
          {{ statusLabels[track.status] }}
        </span>
      </template>
    </div>

    <div class="track-row__actions">
      <button
        v-if="props.showAddToPlaylist"
        class="track-row__action track-row__action--playlist"
        type="button"
        aria-label="Добавить в плейлист"
        @click.stop="emit('addToPlaylist')"
      >
        <AppIcon name="playlist" class="track-row__action-icon" />
      </button>
      <button
        class="track-row__action track-row__action--like"
        :class="{ 'track-row__action--liked': props.isLiked }"
        type="button"
        :disabled="props.isTogglingLike === true"
        :aria-pressed="props.isLiked === true"
        :aria-label="props.isLiked ? `Убрать из любимых: ${track.title}` : `В любимые: ${track.title}`"
        @click.stop="emit('toggleLike')"
      >
        <AppIcon name="heart" :filled="props.isLiked === true" class="track-row__action-icon" />
      </button>
      <button
        class="track-row__action track-row__action--delete"
        type="button"
        :disabled="isDeleting"
        :aria-label="removeIcon === 'close' ? `Убрать из плейлиста: ${track.title}` : `Удалить: ${track.title}`"
        @click.stop="emit('remove')"
      >
        <AppIcon :name="removeIcon" class="track-row__action-icon" />
      </button>
    </div>

    <span v-if="deleteErrorMessage" class="track-row__error" role="status">{{ deleteErrorMessage }}</span>
  </li>
</template>
