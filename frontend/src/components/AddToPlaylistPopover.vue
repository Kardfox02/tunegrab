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
