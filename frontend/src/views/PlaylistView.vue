<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import AppIcon from '@/components/AppIcon.vue'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import LoadingState from '@/components/LoadingState.vue'
import TrackList from '@/components/TrackList.vue'
import { createAbortGroup } from '@/api/client'
import { listTracks } from '@/api/tracks-api'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { usePlayerStore } from '@/stores/player.store'
import { usePlaylistsStore } from '@/stores/playlists.store'
import { useProfileStore } from '@/stores/profile.store'
import { isApiError } from '@/types/errors'
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

// ── Пикер треков ────────────────────────────────────────────────────────────

const PICKER_PAGE_LIMIT = 50
const PICKER_DEBOUNCE_MS = 350

// Состояние пикера локальное: одноразовый UI-стейт, не претендует на место
// в глобальном store. Запросы идут мимо library.store — его query/sort не трогаем.
// pickerResults — единый источник данных: и первый запрос при открытии,
// и поиск, и догрузка при скролле пишут в него.
const pickerResults = ref<Track[]>([])
const pickerTotal = ref(0)
const pickerCursor = ref(0)
const isLoadingPickerPage = ref(false)
const pickerError = ref<string | null>(null)
const pickerQuery = ref('')
const pickerNextPagePromise: { current: Promise<void> | null } = { current: null }

const pickerAbortGroup = createAbortGroup()
let pickerDebounceTimer: number | null = null

const inPlaylistIds = computed(() => new Set(playlists.detailTracks.map((track) => track.id)))

// Уже добавленные треки скрываются из выдачи (клиентский фильтр).
const pickerVisibleResults = computed(() =>
  pickerResults.value.filter((track) => !inPlaylistIds.value.has(track.id)),
)

const hasMorePickerResults = computed(() => pickerCursor.value < pickerTotal.value)

async function loadPickerPage(): Promise<void> {
  if (isLoadingPickerPage.value || !isPickerOpen.value) {
    return
  }

  // Дедупликация параллельных вызовов — один Promise (как loadNextLikes).
  if (pickerNextPagePromise.current) {
    return pickerNextPagePromise.current
  }

  const request = (async () => {
    isLoadingPickerPage.value = true
    try {
      const query = pickerQuery.value.trim()
      const signal = pickerAbortGroup.nextSignal()
      const response = await listTracks(
        {
          q: query.length > 0 ? query : undefined,
          limit: PICKER_PAGE_LIMIT,
          offset: pickerCursor.value,
        },
        signal,
      )
      if (signal.aborted) {
        return
      }
      if (!Array.isArray(response?.items)) {
        throw new Error('Malformed tracks response')
      }

      // Offset-пагинация + скрытие добавленных дают дубли между партиями — фильтруем.
      const knownIds = new Set([
        ...pickerResults.value.map((track) => track.id),
        ...inPlaylistIds.value,
      ])
      const fresh = response.items.filter((track) => !knownIds.has(track.id))
      pickerResults.value = [...pickerResults.value, ...fresh]
      pickerCursor.value += response.items.length
      pickerTotal.value = response.total
      pickerError.value = null
    } catch (error: unknown) {
      if (isApiError(error) && error.aborted) {
        return
      }
      pickerError.value = isApiError(error) ? error.detail : 'Не удалось загрузить треки'
    } finally {
      isLoadingPickerPage.value = false
      pickerNextPagePromise.current = null
    }
  })()

  pickerNextPagePromise.current = request
  return request
}

function runPickerSearch(): void {
  // Новый поиск: гасим догрузку, сбрасываем курсор и грузим первую партию.
  pickerCursor.value = 0
  pickerTotal.value = 0
  pickerResults.value = []
  void loadPickerPage()
}

function resetPickerState(): void {
  if (pickerDebounceTimer !== null) {
    window.clearTimeout(pickerDebounceTimer)
    pickerDebounceTimer = null
  }
  pickerAbortGroup.abort()
  pickerResults.value = []
  pickerCursor.value = 0
  pickerTotal.value = 0
  pickerError.value = null
  pickerQuery.value = ''
}

function openPicker(): void {
  resetPickerState()
  isPickerOpen.value = true
  void loadPickerPage()
}

function closePicker(): void {
  isPickerOpen.value = false
}

watch(pickerQuery, () => {
  if (pickerDebounceTimer !== null) {
    window.clearTimeout(pickerDebounceTimer)
  }
  pickerDebounceTimer = window.setTimeout(() => {
    pickerDebounceTimer = null
    if (isPickerOpen.value) {
      runPickerSearch()
    }
  }, PICKER_DEBOUNCE_MS)
})

onUnmounted(() => {
  if (pickerDebounceTimer !== null) {
    window.clearTimeout(pickerDebounceTimer)
  }
  pickerAbortGroup.abort()
})

const pickerSentinel = ref<HTMLElement | null>(null)

useInfiniteScroll({
  target: pickerSentinel,
  onIntersect: () => void loadPickerPage(),
  isDisabled: () =>
    !isPickerOpen.value || isLoadingPickerPage.value || !hasMorePickerResults.value,
})

async function addTrackToPlaylist(track: Track): Promise<void> {
  if (playlistId.value === null) {
    return
  }
  await playlists.addTrack(playlistId.value, track.id)
}

// ── Drag&drop reorder ───────────────────────────────────────────────────────

const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)

const AUTO_SCROLL_EDGE = 80
const AUTO_SCROLL_MAX_SPEED = 14

let autoScrollPointerY = 0
let autoScrollRaf: number | null = null

function autoScrollStep(): void {
  if (dragIndex.value === null) {
    autoScrollRaf = null
    return
  }

  const edgeBottom = window.innerHeight - AUTO_SCROLL_EDGE
  let speed = 0
  if (autoScrollPointerY < AUTO_SCROLL_EDGE) {
    // Чем ближе к краю — тем быстрее (1 у границы зоны, MAX у самого края).
    speed = -Math.round(AUTO_SCROLL_MAX_SPEED * (1 - autoScrollPointerY / AUTO_SCROLL_EDGE) + 1)
  } else if (autoScrollPointerY > edgeBottom) {
    const depth = (autoScrollPointerY - edgeBottom) / AUTO_SCROLL_EDGE
    speed = Math.round(AUTO_SCROLL_MAX_SPEED * depth + 1)
  }

  if (speed !== 0) {
    window.scrollBy(0, speed)
  }
  autoScrollRaf = window.requestAnimationFrame(autoScrollStep)
}

function onDragPointerMove(event: PointerEvent): void {
  autoScrollPointerY = event.clientY
}

function startAutoScrollTracking(): void {
  autoScrollPointerY = 0
  document.addEventListener('pointermove', onDragPointerMove)
  if (autoScrollRaf === null) {
    autoScrollRaf = window.requestAnimationFrame(autoScrollStep)
  }
}

function stopAutoScrollTracking(): void {
  document.removeEventListener('pointermove', onDragPointerMove)
  if (autoScrollRaf !== null) {
    window.cancelAnimationFrame(autoScrollRaf)
    autoScrollRaf = null
  }
}

function onRowDragStart(index: number): void {
  dragIndex.value = index
  startAutoScrollTracking()
}

function onRowDragOver(index: number): void {
  if (dragIndex.value === null || dragIndex.value === index) {
    return
  }
  dropIndex.value = index
}

async function onRowDragEnd(): Promise<void> {
  stopAutoScrollTracking()
  const from = dragIndex.value
  const to = dropIndex.value
  dragIndex.value = null
  dropIndex.value = null

  if (from === null || to === null || from === to) {
    return
  }

  const items = [...playlists.detailTracks]
  const [moved] = items.splice(from, 1)
  if (!moved) {
    return
  }
  items.splice(to, 0, moved)
  await playlists.reorder(playlistId.value ?? 0, items)
}

onUnmounted(stopAutoScrollTracking)

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

    <ErrorState
      v-else-if="playlists.detailError"
      :message="playlists.detailError"
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

      <section class="card settings-section" aria-label="Треки плейлиста">
        <h2 class="settings-section__title">Треки</h2>

        <button
          class="playlist-view__add-track"
          type="button"
          @click="isPickerOpen ? closePicker() : openPicker()"
        >
          <AppIcon name="plus" />
          <span>{{ isPickerOpen ? 'Скрыть' : 'Добавить трек' }}</span>
        </button>

        <div v-if="isPickerOpen" class="playlist-picker">
          <input
            v-model="pickerQuery"
            class="input playlist-picker__search"
            type="search"
            placeholder="Поиск в библиотеке…"
            aria-label="Поиск трека в библиотеке"
          >
          <p v-if="pickerError" class="playlist-picker__error">{{ pickerError }}</p>
          <p v-else-if="pickerVisibleResults.length === 0 && !isLoadingPickerPage" class="playlist-picker__empty">
            {{ pickerQuery.trim() ? 'Ничего не найдено' : 'Все треки уже в плейлисте' }}
          </p>
          <ul v-else class="playlist-picker__list">
            <li v-for="track in pickerVisibleResults" :key="track.id">
              <button type="button" class="playlist-picker__item" @click="addTrackToPlaylist(track)">
                <img
                  v-if="track.cover_url"
                  :src="track.cover_url"
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="playlist-picker__cover"
                >
                <span v-else class="playlist-picker__cover playlist-picker__cover--placeholder" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M9 18V6.5L19 5v11.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
                    <circle cx="16.5" cy="16.5" r="2.5" fill="currentColor" />
                  </svg>
                </span>
                <span class="playlist-picker__info">
                  <span class="playlist-picker__title">{{ track.title }}</span>
                  <span class="playlist-picker__author">{{ track.author }}</span>
                </span>
                <AppIcon name="plus" class="playlist-picker__add-icon" />
              </button>
            </li>
          </ul>
          <div v-if="hasMorePickerResults" ref="pickerSentinel" class="library-view__sentinel">
            <span v-if="isLoadingPickerPage" class="spinner" aria-hidden="true"></span>
          </div>
        </div>

        <p v-if="playlists.detailTracks.length === 0" class="settings-section__empty">
          Плейлист пуст — добавьте треки кнопкой выше.
        </p>

        <TrackList
          v-else
          :tracks="playlists.detailTracks"
          :deleting-ids="[]"
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
          @drag-over-row="onRowDragOver"
          @drag-end="onRowDragEnd"
        />
      </section>
    </template>
  </div>
</template>
