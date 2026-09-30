<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import LoadingState from '@/components/LoadingState.vue'
import TrackList from '@/components/TrackList.vue'
import AddToPlaylistPopover from '@/components/AddToPlaylistPopover.vue'
import AppIcon from '@/components/AppIcon.vue'
import { useDownloadsStore } from '@/stores/downloads.store'
import { useLibraryStore } from '@/stores/library.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { usePlayerStore } from '@/stores/player.store'
import { usePlaylistsStore } from '@/stores/playlists.store'
import { useProfileStore } from '@/stores/profile.store'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { useDebouncedWatch } from '@/composables/useDebouncedWatch'
import { useAddToPlaylistPopover } from '@/composables/useAddToPlaylistPopover'
import { formatTrackCount } from '@/utils/plural'
import type { Track, TrackSortField, TrackSortOrder } from '@/types/track'

const route = useRoute()
const router = useRouter()
const library = useLibraryStore()
const player = usePlayerStore()
const notifications = useNotificationsStore()
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

useDebouncedWatch(searchInput, () => {
  // Значение, совпадающее с URL-запросом (синхронизация из роутера), не толкает.
  if (searchInput.value.trim() === readRouteQuery(route.query.q)) {
    return
  }
  void router.push({ query: buildQuery({ q: searchInput.value }) })
}, SEARCH_DEBOUNCE_MS)

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

async function shuffleLibrary(): Promise<void> {
  // Шаффлит отфильтрованный набор (активный поиск + сортировка), с догрузкой
  // всех страниц свыше первых 50. Ошибка сбора — playback не стартует.
  try {
    const allTracks = await library.collectFilteredAll()
    player.playShuffled(allTracks)
  } catch {
    notifications.push('Не удалось собрать треки для перемешивания', 'error')
  }
}

function remove(track: Track): void {
  void library.removeTrack(track.id)
}

function toggleLike(track: Track): void {
  void profile.toggleLike(track)
}

// ── Поповер «Добавить в плейлист» ───────────────────────────────────────────

const { track: popoverTrack, open: openPopover, close: closePopover, choose: choosePlaylist } =
  useAddToPlaylistPopover()

void playlists.load()

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

const counterLabel = computed(() => formatTrackCount(library.total))
</script>

<template>
  <div class="stack library-view">
    <div class="page-header">
      <div>
        <h1>Библиотека</h1>
        <p class="library-view__counter">{{ counterLabel }}</p>
      </div>
      <button
        class="icon-btn"
        type="button"
        aria-label="Перемешать и играть"
        :disabled="library.isCollectingAll || library.total === 0"
        @click="shuffleLibrary"
      >
        <AppIcon name="shuffle" />
        <span>Перемешать</span>
      </button>
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
        @add-to-playlist="(track) => openPopover(track)"
      />

      <AddToPlaylistPopover
        v-if="popoverTrack"
        :track="popoverTrack"
        @close="closePopover"
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
