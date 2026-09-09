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
  showAddToPlaylist?: boolean
  removeIcon?: 'trash' | 'close'
  draggable?: boolean
  dragIndex?: number | null
  dropIndex?: number | null
}>()

const emit = defineEmits<{
  play: [track: Track, index: number]
  remove: [track: Track, index: number]
  toggleLike: [track: Track]
  addToPlaylist: [track: Track]
  dragStart: [index: number]
  dragOverRow: [index: number]
  dragEnd: []
}>()
</script>

<template>
  <ul class="track-list">
    <TrackRow
      v-for="(track, index) in tracks"
      :key="track.id"
      :track="track"
      :is-deleting="deletingIds.includes(track.id)"
      :delete-error-message="deleteError?.id === track.id ? deleteError.message : null"
      :active-download="progressById?.get(track.id) ?? null"
      :is-current="currentTrackId === track.id"
      :is-playing="isPlaying"
      :is-liked="likedTrackIds?.has(track.id) ?? false"
      :is-toggling-like="togglingLikeIds?.has(track.id) ?? false"
      :show-add-to-playlist="showAddToPlaylist"
      :remove-icon="removeIcon"
      :draggable="draggable"
      :is-dragging="dragIndex === index"
      :is-drop-target="dropIndex === index && dragIndex !== index"
      @play="emit('play', track, index)"
      @remove="emit('remove', track, index)"
      @toggle-like="emit('toggleLike', track)"
      @add-to-playlist="emit('addToPlaylist', track)"
      @drag-start="emit('dragStart', index)"
      @pointerenter="dragIndex !== null && emit('dragOverRow', index)"
      @drag-end="emit('dragEnd')"
    />
  </ul>
</template>
