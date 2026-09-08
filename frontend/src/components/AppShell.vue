<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

import AppHeader from './AppHeader.vue'
import AppSidebar from './AppSidebar.vue'
import PlayerBar from './PlayerBar.vue'
import { useLibraryStore } from '@/stores/library.store'
import { usePlayerStore } from '@/stores/player.store'
import type { Track } from '@/types/track'

const player = usePlayerStore()
const library = useLibraryStore()

function supplyNextTracks(_lastTrackId: number): Promise<Track[]> {
  return library.loadNextPage()
}

onMounted(() => {
  player.setQueueSupplier(supplyNextTracks)
})

onUnmounted(() => {
  player.setQueueSupplier(null)
})
</script>

<template>
  <div class="app-shell">
    <AppHeader />
    <AppSidebar />
    <main class="app-shell__content">
      <div class="page">
        <RouterView />
      </div>
    </main>
    <PlayerBar />
  </div>
</template>
