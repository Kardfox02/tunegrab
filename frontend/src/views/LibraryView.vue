<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import LoadingState from '@/components/LoadingState.vue'
import TrackList from '@/components/TrackList.vue'
import AddToPlaylistPopover from '@/components/AddToPlaylistPopover.vue'
import { useDownloadsStore } from '@/stores/downloads.store'
import { useLibraryStore } from '@/stores/library.store'
import { usePlayerStore } from '@/stores/player.store'
import { usePlaylistsStore } from '@/stores/playlists.store'
import { useProfileStore } from '@/stores/profile.store'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import type { Track, TrackSortField, TrackSortOrder } from '@/types/track'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()
const downloads = useDownloadsStore()
const profile = useProfileStore()
const playlists = usePlaylistsStore()

// Сердечкам в строках нужен набор лайков; профиль грузится лениво один раз.
void profile.loadProfile()

const DEFAULT_SORT_BY: TrackSortField = 'created_at'
const DEFAULT_ORDER: TrackSortOrder = 'desc'
const SEARCH_DEBOUNCE_MS = 350

const sortOptions: Array<{ field: TrackSortField; label: string }> = [
  { field: 'created_at', label: 'Недавние' },
  { field: 'title', label: 'Название' },
  { field: 'duration', label: 'Длительность' },
]

function readRouteQuery(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function buildQuery(
  overrides: Partial<{ q: string; sort_by: TrackSortField; order: TrackSortOrder }> = {},
): Record<string, string> {
  const q = (overrides.q ?? library.query).trim()
  const sort_by = overrides.sort_by ?? library.sortBy
  const order = overrides.order ?? library.order

  const nextQuery: Record<string, string> = {}
  if (q.length > 0) {
    nextQuery.q = q
  }
  if (sort_by !== DEFAULT_SORT_BY) {
    nextQuery.sort_by = sort_by
  }
  if (order !== DEFAULT_ORDER) {
    nextQuery.order = order
  }
  return nextQuery
}

const searchInput = ref('')

watch(
  () => route.query,
  (routeQuery) => {
    library.applyRouteQuery(routeQuery)
    const urlQuery = readRouteQuery(routeQuery.q)
    if (searchInput.value !== urlQuery) {
      searchInput.value = urlQuery
    }
  },
  { immediate: true },
)

let searchTimer: number | null = null

watch(searchInput, (value) => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
    searchTimer = null
  }

  if (value.trim() === readRouteQuery(route.query.q)) {
    return
  }

  searchTimer = window.setTimeout(() => {
    searchTimer = null
    void router.push({ query: buildQuery({ q: value }) })
  }, SEARCH_DEBOUNCE_MS)
})

onUnmounted(() => {
  if (searchTimer !== null) {
    window.clearTimeout(searchTimer)
  }
})

function selectSort(field: TrackSortField): void {
  if (library.sortBy === field) {
    const nextOrder: TrackSortOrder = library.order === 'asc' ? 'desc' : 'asc'
    void router.push({ query: buildQuery({ sort_by: field, order: nextOrder }) })
    return
  }

  const nextOrder: TrackSortOrder = field === 'created_at' ? 'desc' : 'asc'
  void router.push({ query: buildQuery({ sort_by: field, order: nextOrder }) })
}

function play(track: Track): void {
  player.playOrToggle(track, library.tracks)
}

function remove(track: Track): void {
  void library.removeTrack(track.id)
}

function toggleLike(track: Track): void {
  void profile.toggleLike(track)
}

// ── Поповер «Добавить в плейлист» ───────────────────────────────────────────

const addToPlaylistTrack = ref<Track | null>(null)

void playlists.load()

async function choosePlaylist(playlistId: number): Promise<void> {
  const track = addToPlaylistTrack.value
  if (!track) {
    return
  }
  addToPlaylistTrack.value = null
  await playlists.addTrack(playlistId, track.id)
}

function loadMore(): void {
  void library.loadNextPage()
}

const sentinelElement = ref<HTMLElement | null>(null)

useInfiniteScroll({
  target: sentinelElement,
  onIntersect: loadMore,
  isDisabled: () =>
    !library.isInitialized || library.isLoading || !library.hasMore || library.isLoadingNextPage,
})

const counterLabel = computed(() => {
  const count = library.total
  const lastDigit = count % 10
  const lastTwoDigits = count % 100
  if (lastDigit === 1 && lastTwoDigits !== 11) {
    return `${count} трек`
  }
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return `${count} трека`
  }
  return `${count} треков`
})
</script>

<template>
  <div class="stack library-view">
    <div class="page-header">
      <div>
        <h1>Библиотека</h1>
        <p class="library-view__counter">{{ counterLabel }}</p>
      </div>
    </div>

    <div class="search-field">
      <svg class="search-field__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
        <path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input
        v-model="searchInput"
        class="input search-field__input"
        type="search"
        placeholder="Поиск по названию или автору"
        aria-label="Поиск по библиотеке"
        autocomplete="off"
      >
    </div>

    <div class="segmented" role="group" aria-label="Сортировка">
      <button
        v-for="option in sortOptions"
        :key="option.field"
        class="segmented__button"
        type="button"
        :class="{ 'segmented__button--active': library.sortBy === option.field }"
        :aria-pressed="library.sortBy === option.field"
        @click="selectSort(option.field)"
      >
        {{ option.label }}
        <span v-if="library.sortBy === option.field" aria-hidden="true">
          {{ library.order === 'asc' ? '↑' : '↓' }}
        </span>
      </button>
    </div>

    <LoadingState v-if="library.isLoading && library.tracks.length === 0" />

    <ErrorState
      v-else-if="library.error"
      :message="library.error.detail"
      @retry="library.load()"
    />

    <EmptyState
      v-else-if="library.tracks.length === 0 && library.isQueryEmpty"
      title="Библиотека пуста"
      message="Найдите трек на YouTube и скачайте его — он появится здесь."
    >
      <RouterLink class="btn btn-primary" to="/search">Перейти к поиску</RouterLink>
    </EmptyState>

    <EmptyState
      v-else-if="library.tracks.length === 0"
      title="Ничего не найдено"
      message="Попробуйте изменить запрос или сбросить сортировку."
    />

    <template v-else>
      <TrackList
        :tracks="library.tracks"
        :deleting-ids="library.deletingIds"
        :delete-error="library.deleteError"
        :progress-by-id="downloads.activeById"
        :current-track-id="player.currentTrack?.id ?? null"
        :is-playing="player.isPlaying"
        :liked-track-ids="profile.likedTrackIds"
        :toggling-like-ids="profile.togglingIds"
        :show-add-to-playlist="true"
        @play="play"
        @remove="remove"
        @toggle-like="toggleLike"
        @add-to-playlist="(track) => (addToPlaylistTrack = track)"
      />

      <AddToPlaylistPopover
        v-if="addToPlaylistTrack"
        :track="addToPlaylistTrack"
        @close="addToPlaylistTrack = null"
        @add="choosePlaylist"
      />

      <div
        v-if="library.hasMore"
        ref="sentinelElement"
        class="library-view__sentinel"
      >
        <span v-if="library.isLoadingNextPage" class="spinner" aria-hidden="true"></span>
        <span class="visually-hidden" aria-live="polite">
          {{ library.isLoadingNextPage ? 'Загружаем еще треки' : '' }}
        </span>
      </div>
    </template>
  </div>
</template>
