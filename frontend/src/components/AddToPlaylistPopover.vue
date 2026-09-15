<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { usePlaylistsStore } from '@/stores/playlists.store'
import AppIcon from '@/components/AppIcon.vue'
import type { Track } from '@/types/track'

defineProps<{ track: Track }>()

const emit = defineEmits<{ close: []; add: [playlistId: number] }>()

const playlists = usePlaylistsStore()

// Диалог закрывается по Escape и по клику/тапу вне себя: без этого поповер
// можно закрыть только кнопкой ✕ — недопустимо для role="dialog".
const rootElement = ref<HTMLElement | null>(null)

function onDocumentPointerDown(event: PointerEvent): void {
  const root = rootElement.value
  if (root !== null && event.target instanceof Node && !root.contains(event.target)) {
    emit('close')
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown, true)
  document.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div ref="rootElement" class="playlist-popover" role="dialog" aria-label="Добавить в плейлист">
    <div class="playlist-popover__header">
      <span>Добавить «{{ track.title }}» в…</span>
      <button class="playlist-popover__close" type="button" aria-label="Закрыть" @click="emit('close')">
        ✕
      </button>
    </div>
    <div class="playlist-popover__grid">
      <button
        v-for="playlist in playlists.playlists"
        :key="playlist.id"
        type="button"
        class="playlist-popover__tile"
        @click="emit('add', playlist.id)"
      >
        <span class="playlist-popover__icon" aria-hidden="true">
          <AppIcon name="playlist" />
        </span>
        <span class="playlist-popover__name">{{ playlist.name }}</span>
        <span v-if="!playlist.is_owner" class="playlist-popover__owner">от {{ playlist.owner_username }}</span>
        <span class="playlist-popover__count">{{ playlist.track_count }}</span>
      </button>
      <p v-if="!playlists.hasPlaylists" class="playlist-popover__empty">Плейлистов пока нет</p>
    </div>
  </div>
</template>
