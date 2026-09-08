<script setup lang="ts">
import TrackRow from './TrackRow.vue'
import type { Track } from '@/types/track'

defineProps<{
  tracks: Track[]
  deletingIds: number[]
  deleteError: { id: number; message: string } | null
  progressById?: Map<number, Track> | null
  currentTrackId?: number | null
  isPlaying?: boolean
  likedTrackIds?: Set<number>
  togglingLikeIds?: Set<number>
}>()

const emit = defineEmits<{ play: [track: Track]; remove: [track: Track]; toggleLike: [track: Track] }>()
</script>

<template>
  <ul class="track-list">
    <TrackRow
      v-for="track in tracks"
      :key="track.id"
      :track="track"
      :is-deleting="deletingIds.includes(track.id)"
      :delete-error-message="deleteError?.id === track.id ? deleteError.message : null"
      :active-download="progressById?.get(track.id) ?? null"
      :is-current="currentTrackId === track.id"
      :is-playing="isPlaying"
      :is-liked="likedTrackIds?.has(track.id) ?? false"
      :is-toggling-like="togglingLikeIds?.has(track.id) ?? false"
      @play="emit('play', track)"
      @remove="emit('remove', track)"
      @toggle-like="emit('toggleLike', track)"
    />
  </ul>
</template>
