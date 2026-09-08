<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import AppIcon from './AppIcon.vue'
import { useSwipeSwitch, type SwipeDirection } from '@/composables/useSwipeSwitch'
import { usePlayerStore, type PlayerAudioController } from '@/stores/player.store'
import { useProfileStore } from '@/stores/profile.store'

const player = usePlayerStore()
const profile = useProfileStore()

const isCurrentLiked = computed(() =>
  player.currentTrack !== null && profile.likedTrackIds.has(player.currentTrack.id),
)
const isCurrentTogglingLike = computed(() =>
  player.currentTrack !== null && profile.togglingIds.has(player.currentTrack.id),
)

function toggleCurrentLike(): void {
  if (player.currentTrack) {
    void profile.toggleLike(player.currentTrack)
  }
}

const audioElement = ref<HTMLAudioElement | null>(null)

const hasTrack = computed(() => player.currentTrack !== null)
const coverUrl = computed(() => player.currentTrack?.cover_url ?? null)
const title = computed(() => player.currentTrack?.title ?? 'Трек не выбран')
const author = computed(() => player.currentTrack?.author ?? '')

const barElement = ref<HTMLElement | null>(null)

function measureBarWidth(): number {
  return barElement.value?.getBoundingClientRect().width ?? 0
}

const swipe = useSwipeSwitch({
  thresholdRatio: 0.25,
  getLength: measureBarWidth,
  shouldIgnoreTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('button, input, a') !== null
  },
  onSwipe(direction: SwipeDirection): void {
    if (direction === 'left') {
      player.playNext()
    } else {
      player.playPrevious()
    }
  },
})

const barStyle = computed<Record<string, string>>(() => ({
  ...(player.trackAccent ? { '--track-accent': player.trackAccent } : {}),
  ...swipe.dragStyle.value,
}))

const controller: PlayerAudioController = {
  load(src: string): void {
    const audio = audioElement.value
    if (!audio) {
      return
    }
    audio.src = src
    audio.load()
  },
  play(): void {
    const audio = audioElement.value
    if (!audio) {
      return
    }
    Promise.resolve(audio.play()).catch(() => {
      // Отказ autoplay (например, iOS Safari) — не считается ошибкой приложения.
      player.audioPaused()
    })
  },
  pause(): void {
    audioElement.value?.pause()
  },
  seek(time: number): void {
    const audio = audioElement.value
    if (audio) {
      audio.currentTime = time
    }
  },
  setVolume(volume: number): void {
    const audio = audioElement.value
    if (audio) {
      audio.volume = volume
    }
  },
}

onMounted(() => {
  player.bindAudioController(controller)
})

onUnmounted(() => {
  player.bindAudioController(null)
})

function onTimeUpdate(event: Event): void {
  const audio = event.target as HTMLAudioElement
  player.audioTimeUpdate(audio.currentTime)
}

function onLoadedMetadata(event: Event): void {
  const audio = event.target as HTMLAudioElement
  player.audioDurationChanged(audio.duration)
}

function onSeekInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) {
    player.seek(value)
  }
}

function onVolumeInput(event: Event): void {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) {
    player.setVolume(value)
  }
}

function formatTime(time: number): string {
  if (!Number.isFinite(time) || time < 0) {
    return '0:00'
  }
  const totalSeconds = Math.floor(time)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}
</script>

<template>
  <section
    ref="barElement"
    class="player-bar"
    :class="{
      'player-bar--hidden': !player.hasCurrentTrack,
      'player-bar--dragging': swipe.isDragging.value,
    }"
    :style="barStyle"
    role="group"
    aria-label="Плеер"
    @pointerdown="swipe.onPointerDown"
    @pointermove="swipe.onPointerMove"
    @pointerup="swipe.onPointerUp"
    @pointercancel="swipe.onPointerUp"
  >
    <audio
      ref="audioElement"
      preload="auto"
      @play="player.audioPlaying"
      @pause="player.audioPaused"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @waiting="player.audioWaiting"
      @stalled="player.audioWaiting"
      @canplay="player.audioCanPlay"
      @ended="player.audioEnded"
      @error="player.audioFailed('Не удалось воспроизвести трек')"
    ></audio>

    <button
      v-if="hasTrack"
      class="player-bar__like"
      :class="{ 'player-bar__like--liked': isCurrentLiked }"
      type="button"
      :disabled="isCurrentTogglingLike"
      :aria-pressed="isCurrentLiked"
      :aria-label="isCurrentLiked ? 'Убрать из любимых' : 'В любимые'"
      @click.stop="toggleCurrentLike"
    >
      <AppIcon name="heart" :filled="isCurrentLiked" class="player-bar__like-icon" />
    </button>

    <div class="player-bar__cover" aria-hidden="true">
      <img v-if="coverUrl" :src="coverUrl" alt="" loading="lazy" decoding="async">
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
    </div>

    <div class="player-bar__info">
      <span class="player-bar__title">{{ title }}</span>
      <span v-if="author" class="player-bar__author">{{ author }}</span>
      <span v-if="player.playbackError" class="player-bar__error" role="status">
        {{ player.playbackError }}
      </span>
    </div>

    <div class="player-bar__seek">
      <span class="player-bar__time">{{ formatTime(player.position) }}</span>
      <input
        v-show="hasTrack"
        class="player-bar__slider"
        type="range"
        min="0"
        :max="player.duration || 1"
        step="0.1"
        :value="player.position"
        :disabled="!hasTrack"
        aria-label="Позиция воспроизведения"
        @input="onSeekInput"
      >
      <span class="player-bar__time">{{ formatTime(player.duration) }}</span>
    </div>

    <div class="player-bar__transport">
      <button
        class="player-bar__skip"
        type="button"
        :disabled="!hasTrack"
        aria-label="Предыдущий трек"
        @click="player.playPrevious()"
      >
        <AppIcon name="skip-prev" class="player-bar__skip-icon" />
      </button>

      <button
        class="player-bar__play"
        type="button"
        :disabled="!hasTrack"
        :aria-label="player.isPlaying ? 'Пауза' : 'Воспроизвести'"
        @click="player.togglePlay()"
      >
        <AppIcon :name="player.isPlaying ? 'pause' : 'play'" class="player-bar__play-icon" />
      </button>

      <button
        class="player-bar__skip"
        type="button"
        :disabled="!hasTrack"
        aria-label="Следующий трек"
        @click="player.playNext()"
      >
        <AppIcon name="skip-next" class="player-bar__skip-icon" />
      </button>
    </div>

    <div class="player-bar__volume">
      <AppIcon name="volume" class="player-bar__volume-icon" />
      <input
        class="player-bar__slider"
        type="range"
        min="0"
        max="1"
        step="0.05"
        :value="player.volume"
        aria-label="Громкость"
        @input="onVolumeInput"
      >
    </div>
  </section>
</template>
