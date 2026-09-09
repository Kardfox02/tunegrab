<script setup lang="ts">
import { usePlaylistsStore } from '@/stores/playlists.store'
import AppIcon from '@/components/AppIcon.vue'
import type { Track } from '@/types/track'

defineProps<{ track: Track }>()

const emit = defineEmits<{ close: []; add: [playlistId: number] }>()

const playlists = usePlaylistsStore()
</script>

<template>
  <div class="playlist-popover" role="dialog" aria-label="Добавить в плейлист">
    <div class="playlist-popover__header">
      <span>Добавить «{{ track.title }}» в…</span>
      <button class="playlist-popover__close" type="button" aria-label="Закрыть" @click="emit('close')">
        ✕
      </button>
    </div>
    <ul class="playlist-popover__list">
      <li v-for="playlist in playlists.playlists" :key="playlist.id">
        <button type="button" class="playlist-popover__item" @click="emit('add', playlist.id)">
          <AppIcon name="playlist" class="playlist-popover__icon" />
          <span class="playlist-popover__name">{{ playlist.name }}</span>
          <span class="playlist-popover__count">{{ playlist.track_count }}</span>
        </button>
      </li>
      <li v-if="!playlists.hasPlaylists" class="playlist-popover__empty">Плейлистов пока нет</li>
    </ul>
  </div>
</template>
