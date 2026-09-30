<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'

import AppIcon from './AppIcon.vue'
import { createAbortGroup } from '@/api/client'
import { listTracks } from '@/api/tracks-api'
import { useDebouncedWatch } from '@/composables/useDebouncedWatch'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { usePlaylistsStore } from '@/stores/playlists.store'
import { isApiError } from '@/types/errors'
import type { Track } from '@/types/track'

const PAGE_LIMIT = 50
const DEBOUNCE_MS = 350

const props = defineProps<{
  open: boolean
  playlistId: number | null
}>()

const playlists = usePlaylistsStore()

// Состояние пикера локальное: одноразовый UI-стейт, не претендует на место
// в глобальном store. Запросы идут мимо library.store — его query/sort не трогаем.
// results — единый источник данных: и первый запрос при открытии,
// и поиск, и догрузка при скролле пишут в него.
const results = ref<Track[]>([])
const total = ref(0)
const cursor = ref(0)
const isLoadingPage = ref(false)
const error = ref<string | null>(null)
const query = ref('')
const nextPagePromise: { current: Promise<void> | null } = { current: null }

const abortGroup = createAbortGroup()
// Аварийный аборт при размонтировании (in-flight запросы пикера глохнут).
onScopeDispose(() => {
  abortGroup.abort()
})

const inPlaylistIds = computed(() => new Set(playlists.detailTracks.map((track) => track.id)))

// Уже добавленные треки скрываются из выдачи (клиентский фильтр).
const visibleResults = computed(() =>
  results.value.filter((track) => !inPlaylistIds.value.has(track.id)),
)

const hasMoreResults = computed(() => cursor.value < total.value)

async function loadPage(): Promise<void> {
  if (isLoadingPage.value || !props.open) {
    return
  }

  // Дедупликация параллельных вызовов — один Promise (как loadNextLikes).
  if (nextPagePromise.current) {
    return nextPagePromise.current
  }

  let request: Promise<void> = Promise.resolve()
  request = (async () => {
    isLoadingPage.value = true
    try {
      const trimmed = query.value.trim()
      const signal = abortGroup.nextSignal()
      const response = await listTracks(
        {
          q: trimmed.length > 0 ? trimmed : undefined,
          limit: PAGE_LIMIT,
          offset: cursor.value,
        },
        signal,
      )
      if (signal.aborted) {
        return
      }

      // Offset-пагинация + скрытие добавленных дают дубли между партиями — фильтруем.
      const knownIds = new Set([...results.value.map((track) => track.id), ...inPlaylistIds.value])
      const fresh = response.items.filter((track) => !knownIds.has(track.id))
      results.value.push(...fresh)
      cursor.value += response.items.length
      total.value = response.total
      error.value = null
    } catch (cause: unknown) {
      if (isApiError(cause) && cause.aborted) {
        return
      }
      error.value = isApiError(cause) ? cause.detail : 'Не удалось загрузить треки'
    } finally {
      isLoadingPage.value = false
      if (nextPagePromise.current === request) {
        nextPagePromise.current = null
      }
    }
  })()

  nextPagePromise.current = request
  return request
}

function runSearch(): void {
  // Новый поиск сбрасывает состояние, но in-flight запрос предыдущего поиска
  // мог ещё лететь: его ранний `return` по isLoadingPage вернул бы
  // Promise старого запроса, а его ответ (без aborted-проверки) дописался бы
  // в сброшенный список. Абортим — старый ответ отбрасывается корректно.
  abortGroup.nextSignal()
  isLoadingPage.value = false
  nextPagePromise.current = null
  cursor.value = 0
  total.value = 0
  results.value = []
  void loadPage()
}

function resetState(): void {
  abortGroup.abort()
  results.value = []
  cursor.value = 0
  total.value = 0
  error.value = null
  query.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetState()
      void loadPage()
    }
  },
  { immediate: true },
)

useDebouncedWatch(query, () => {
  if (props.open) {
    runSearch()
  }
}, DEBOUNCE_MS)

const sentinel = ref<HTMLElement | null>(null)

useInfiniteScroll({
  target: sentinel,
  onIntersect: () => void loadPage(),
  isDisabled: () => !props.open || isLoadingPage.value || !hasMoreResults.value,
})

async function addTrack(track: Track): Promise<void> {
  if (props.playlistId === null) {
    return
  }
  await playlists.addTrack(props.playlistId, track.id)
}
</script>

<template>
  <div class="playlist-picker">
    <input
      v-model="query"
      class="input playlist-picker__search"
      type="search"
      placeholder="Поиск в библиотеке…"
      aria-label="Поиск трека в библиотеке"
    >
    <p v-if="error" class="playlist-picker__error">{{ error }}</p>
    <p v-else-if="visibleResults.length === 0 && !isLoadingPage" class="playlist-picker__empty">
      {{ query.trim() ? 'Ничего не найдено' : 'Все треки уже в плейлисте' }}
    </p>
    <ul v-else class="playlist-picker__list">
      <li v-for="track in visibleResults" :key="track.id">
        <button type="button" class="playlist-picker__item" @click="addTrack(track)">
          <img
            v-if="track.cover_url"
            :src="track.cover_url"
            alt=""
            loading="lazy"
            decoding="async"
            class="playlist-picker__cover"
          >
          <span v-else class="playlist-picker__cover playlist-picker__cover--placeholder" aria-hidden="true">
            <AppIcon name="note" />
          </span>
          <span class="playlist-picker__info">
            <span class="playlist-picker__title">{{ track.title }}</span>
            <span class="playlist-picker__author">{{ track.author }}</span>
          </span>
          <AppIcon name="plus" class="playlist-picker__add-icon" />
        </button>
      </li>
    </ul>
    <div v-if="hasMoreResults" ref="sentinel" class="library-view__sentinel">
      <span v-if="isLoadingPage" class="spinner" aria-hidden="true"></span>
    </div>
  </div>
</template>
