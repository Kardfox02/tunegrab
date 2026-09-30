<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import ErrorState from '@/components/ErrorState.vue'
import LoadingState from '@/components/LoadingState.vue'
import PlaylistTrackPicker from '@/components/PlaylistTrackPicker.vue'
import TrackList from '@/components/TrackList.vue'
import { usePlaylistDragReorder } from '@/composables/usePlaylistDragReorder'
import { usePlayerStore } from '@/stores/player.store'
import { usePlaylistsStore } from '@/stores/playlists.store'
import { useProfileStore } from '@/stores/profile.store'
import { formatTrackCount } from '@/utils/plural'
import type { Track } from '@/types/track'

const route = useRoute()
const router = useRouter()
const playlists = usePlaylistsStore()
const player = usePlayerStore()
const profile = useProfileStore()

const playlistId = computed(() => {
  const raw = route.params.id
  const id = typeof raw === 'string' ? Number(raw) : Number.NaN
  return Number.isInteger(id) && id > 0 ? id : null
})

const isPickerOpen = ref(false)

const isRemovingTrack = ref(false)

// ── Drag&drop reorder (движок в usePlaylistDragReorder) ─────────────────────

const { dragIndex, dropIndex, onRowDragStart, onRowDragEnd } = usePlaylistDragReorder({
  commit: (from, to) => {
    const items = [...playlists.detailTracks]
    const [moved] = items.splice(from, 1)
    if (!moved) {
      return
    }
    items.splice(to, 0, moved)

    if (playlistId.value === null) {
      return
    }
    void playlists.reorder(playlistId.value, items)
  },
})

// ── Пикер треков ────────────────────────────────────────────────────────────

function togglePicker(): void {
  isPickerOpen.value = !isPickerOpen.value
}
// ── Share ───────────────────────────────────────────────────────────────────

const shareUrl = computed(() => playlists.detail?.share_url ?? null)
const isCopied = ref(false)
let copiedTimer: number | null = null

async function createShare(): Promise<void> {
  if (playlistId.value === null) {
    return
  }
  await playlists.share(playlistId.value)
}

async function revokeShare(): Promise<void> {
  if (playlistId.value === null) {
    return
  }
  if (window.confirm('Отозвать ссылку? Она перестанет работать у всех, кому отправлена.')) {
    await playlists.revokeShare(playlistId.value)
  }
}

async function copyShareLink(): Promise<void> {
  if (!shareUrl.value) {
    return
  }
  const absolute = new URL(shareUrl.value, window.location.origin).toString()
  try {
    await navigator.clipboard.writeText(absolute)
    isCopied.value = true
    if (copiedTimer !== null) {
      window.clearTimeout(copiedTimer)
    }
    copiedTimer = window.setTimeout(() => {
      isCopied.value = false
    }, 2000)
  } catch {
    // clipboard API может отсутствовать (небезопасный контекст) — показываем
    // ссылку в промпте как fallback.
    window.prompt('Скопируйте ссылку:', absolute)
  }
}

onUnmounted(() => {
  if (copiedTimer !== null) {
    window.clearTimeout(copiedTimer)
  }
})

// ── Воспроизведение и удаление ──────────────────────────────────────────────

function playFromPlaylist(track: Track): void {
  player.playOrToggle(track, playlists.detailTracks)
}

function shufflePlaylist(): void {
  player.playShuffled(playlists.detailTracks)
}

function removeTrackFromPlaylist(track: Track): void {
  if (playlistId.value === null || isRemovingTrack.value) {
    return
  }
  isRemovingTrack.value = true
  playlists
    .removeTrack(playlistId.value, track.id)
    .finally(() => {
      isRemovingTrack.value = false
    })
}

function renamePlaylist(): void {
  if (playlistId.value === null || !playlists.detail) {
    return
  }
  const name = window.prompt('Новое название плейлиста', playlists.detail.name)?.trim()
  if (name) {
    void playlists.rename(playlistId.value, name)
  }
}

function goBack(): void {
  void router.push({ name: 'profile' })
}

// Соавторский доступ: редактирование (rename/треки/порядок) доступно обоим,
// share-блок и удаление плейлиста — только автору.
const isOwner = computed(() => playlists.detail?.is_owner ?? false)

async function unsubscribeFromPlaylist(): Promise<void> {
  if (playlistId.value === null) {
    return
  }
  if (window.confirm('Отписаться от плейлиста? Он исчезнет из ваших плейлистов.')) {
    const ok = await playlists.unsubscribe(playlistId.value)
    if (ok) {
      await router.push({ name: 'profile' })
    }
  }
}

// Загрузка детальной страницы при входе и при смене id.
watch(
  playlistId,
  (id) => {
    if (id !== null) {
      void playlists.loadDetail(id, true)
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="stack playlist-view">
    <div class="page-header">
      <div class="playlist-view__heading">
        <button
          class="btn btn-secondary playlist-view__back"
          type="button"
          aria-label="Назад к профилю"
          @click="goBack"
        >
          ←
        </button>
        <div>
          <h1>{{ playlists.detail?.name ?? 'Плейлист' }}</h1>
          <p v-if="playlists.detail" class="playlist-view__meta">
            <span v-if="!isOwner" class="playlist-view__owner">от {{ playlists.detail.owner_username }} • </span>{{ formatTrackCount(playlists.detailTracks.length) }}
          </p>
        </div>
      </div>
      <div class="playlist-view__header-actions">
        <button
          class="icon-btn"
          type="button"
          aria-label="Перемешать и играть"
          :disabled="playlists.detailTracks.length === 0"
          @click="shufflePlaylist"
        >
          <AppIcon name="shuffle" />
          <span>Перемешать</span>
        </button>
        <button class="btn btn-secondary" type="button" @click="renamePlaylist">Переименовать</button>
        <button
          v-if="!isOwner"
          class="btn btn-secondary playlist-view__unsubscribe"
          type="button"
          @click="unsubscribeFromPlaylist"
        >
          Отписаться
        </button>
      </div>
    </div>

    <LoadingState v-if="playlists.isDetailLoading && !playlists.detail" message="Загружаем плейлист…" />

    <!-- Невалидный :id (NaN / 0 / отрицательное): раньше страница молчала —
         ни Loading, ни Error не рисовались. Явное состояние «не найден». -->
    <ErrorState
      v-else-if="playlistId === null"
      message="Плейлист не найден"
    />

    <ErrorState
      v-else-if="playlists.detailError"
      :message="playlists.detailError || undefined"
      @retry="playlistId !== null && playlists.loadDetail(playlistId, true)"
    />

    <template v-else-if="playlists.detail && playlistId !== null">
      <section v-if="isOwner" class="card settings-section" aria-label="Поделиться">
        <h2 class="settings-section__title">Поделиться</h2>
        <div class="playlist-view__share">
          <template v-if="shareUrl">
            <code class="playlist-view__share-url">{{ shareUrl }}</code>
            <button class="btn btn-secondary" type="button" @click="copyShareLink">
              {{ isCopied ? 'Скопировано' : 'Копировать' }}
            </button>
            <button class="btn btn-secondary playlist-view__share-revoke" type="button" @click="revokeShare">
              Отозвать
            </button>
          </template>
          <button v-else class="btn btn-secondary" type="button" @click="createShare">
            Создать ссылку
          </button>
        </div>
        <p class="settings-section__empty">
          Любой, у кого есть ссылка, увидит список треков. Слушать смогут только авторизованные пользователи.
        </p>
      </section>

      <button
        class="playlist-view__add-track"
        type="button"
        @click="togglePicker"
      >
        <AppIcon name="plus" />
        <span>{{ isPickerOpen ? 'Скрыть' : 'Добавить трек' }}</span>
      </button>

      <PlaylistTrackPicker
        v-if="isPickerOpen"
        :open="isPickerOpen"
        :playlist-id="playlistId"
      />

      <p v-if="playlists.detailTracks.length === 0" class="settings-section__empty">
        Плейлист пуст — добавьте треки кнопкой выше.
      </p>

      <TrackList
        v-else
        :tracks="playlists.detailTracks"
        :delete-error="null"
        :current-track-id="player.currentTrack?.id ?? null"
        :is-playing="player.isPlaying"
        :liked-track-ids="profile.likedTrackIds"
        :toggling-like-ids="profile.togglingIds"
        :show-add-to-playlist="false"
        remove-icon="close"
        :draggable="true"
        :drag-index="dragIndex"
        :drop-index="dropIndex"
        @play="playFromPlaylist"
        @remove="removeTrackFromPlaylist"
        @toggle-like="(track) => profile.toggleLike(track)"
        @drag-start="onRowDragStart"
        @drag-end="onRowDragEnd"
      />
    </template>
  </div>
</template>
