<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import AppIcon from './AppIcon.vue'
import DownloadProgress from './DownloadProgress.vue'
import { useIsDesktop } from '@/composables/useMediaQuery'
import { resolveCoverColor } from '@/services/cover-color.service'
import { usePlayerStore } from '@/stores/player.store'
import type { Track, TrackStatus } from '@/types/track'

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
// Кэш сервиса синхронный после первого извлечения — гидратируем ref при
// смене обложки и при готовности цвета.
const accent = ref<string | null>(null)
const accentBump = ref(0)

watch(
  () => props.track.cover_url,
  (coverUrl) => {
    accentBump.value += 1
    accent.value = resolveCoverColor(coverUrl, () => {
      accentBump.value += 1
      accent.value = resolveCoverColor(coverUrl)
    })
  },
  { immediate: true },
)

const rowAccent = computed(() => {
  void accentBump.value
  return accent.value ?? 'var(--color-accent)'
})

const statusLabels: Record<TrackStatus, string> = {
  pending: 'В очереди',
  downloading: 'Загрузка',
  converting: 'Конвертация',
  finalizing: 'Завершение',
  done: 'Готов',
  error: 'Ошибка',
  cancelled: 'Отменён',
}

const statusTones: Record<TrackStatus, 'accent' | 'success' | 'warning' | 'danger'> = {
  pending: 'accent',
  downloading: 'warning',
  converting: 'warning',
  finalizing: 'warning',
  done: 'success',
  error: 'danger',
  cancelled: 'danger',
}

const isPlayable = computed(() => props.track.status === 'done' && props.track.audio_url !== null)

const isDesktop = useIsDesktop()

const canStartPlayback = computed(() => isPlayable.value && !props.isDeleting)

const coverActionLabel = computed(() =>
  isCurrentPlaying.value ? `Пауза: ${props.track.title}` : `Воспроизвести: ${props.track.title}`,
)

const equalizerAccent = computed(() =>
  isCurrent ? (player.trackAccent ?? rowAccent.value) : null,
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
// завершает (родитель слушает document-level pointerup через событие dragEnd).
function onHandlePointerDown(event: PointerEvent): void {
  if (!props.draggable || !event.isPrimary) {
    return
  }
  event.preventDefault()
  emit('dragStart')
}

function onWindowPointerUp(): void {
  if (props.draggable) {
    emit('dragEnd')
  }
}

onMounted(() => {
  window.addEventListener('pointerup', onWindowPointerUp)
})

onUnmounted(() => {
  window.removeEventListener('pointerup', onWindowPointerUp)
})

defineExpose({ rowElement })

const durationLabel = computed(() => {
  const duration = props.track.duration
  if (duration === null) {
    return '—'
  }
  const totalSeconds = Math.round(duration)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
})
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
    >
      <AppIcon name="grip" />
    </span>

    <div class="track-row__cover" aria-hidden="true">
      <img v-if="track.cover_url" :src="track.cover_url" alt="" loading="lazy" decoding="async">
      <svg v-else viewBox="0 0 24 24" fill="none">
        <path
          d="M9 18V6.5L19 5v11.5"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
        <circle cx="16.5" cy="16.5" r="2.5" fill="currentColor" />
      </svg>

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
