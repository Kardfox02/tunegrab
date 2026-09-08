<script setup lang="ts">
import { computed } from 'vue'

import DownloadProgress from './DownloadProgress.vue'
import type { Track } from '@/types/track'
import type { YouTubeSearchResult } from '@/types/youtube'

export interface YouTubeResultCardProps {
  result: YouTubeSearchResult
  downloadState: 'idle' | 'queued' | 'exists'
  errorMessage?: string | null
  activeTrack?: Track | null
}

const props = defineProps<YouTubeResultCardProps>()

const emit = defineEmits<{ download: [] }>()

const durationLabel = computed(() => formatDuration(props.result.duration))

const buttonLabel = computed(() => {
  if (props.downloadState === 'queued') {
    return 'В очереди…'
  }
  if (props.downloadState === 'exists') {
    return 'В библиотеке'
  }
  return 'Скачать'
})

function formatDuration(duration: number | null): string {
  if (duration === null) {
    return '—'
  }
  const totalSeconds = Math.round(duration)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}
</script>

<template>
  <article class="yt-card">
    <a
      class="yt-card__thumb"
      :href="result.webpage_url"
      target="_blank"
      rel="noopener"
      :aria-label="`Открыть на YouTube: ${result.title}`"
    >
      <img v-if="result.thumbnail_url" :src="result.thumbnail_url" alt="" loading="lazy" decoding="async">
      <span v-else class="yt-card__thumb-placeholder" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
      <span class="yt-card__duration">{{ durationLabel }}</span>
    </a>

    <div class="yt-card__body">
      <a class="yt-card__title" :href="result.webpage_url" target="_blank" rel="noopener">
        {{ result.title }}
      </a>
      <span class="yt-card__author">{{ result.author }}</span>

      <DownloadProgress
        v-if="activeTrack"
        class="yt-card__progress"
        :status="activeTrack.status"
        :progress="activeTrack.progress"
      />

      <button
        class="btn btn-secondary yt-card__download"
        type="button"
        :disabled="downloadState !== 'idle'"
        @click="emit('download')"
      >
        {{ buttonLabel }}
      </button>

      <span v-if="errorMessage" class="yt-card__download-error" role="status">{{ errorMessage }}</span>
    </div>
  </article>
</template>
