<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { fetchSharedPlaylist } from '@/api/playlists-api'
import { createAbortGroup } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import { usePlaylistsStore } from '@/stores/playlists.store'
import type { SharedPlaylist } from '@/types/playlists'
import type { Track } from '@/types/track'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const playlists = usePlaylistsStore()

const playlist = ref<SharedPlaylist | null>(null)
const isLoading = ref(false)
const error = ref<string | null>(null)
// id плейлиста после успешной автоподписки (или null — подписка не удалась).
const subscribedPlaylistId = ref<number | null>(null)
const abortGroup = createAbortGroup()

const token = computed(() => {
  const raw = route.params.token
  return typeof raw === 'string' && raw.length > 0 ? raw : null
})

const isLoggedIn = computed(() => auth.currentUser !== null)

const playableTracks = computed<Track[]>(() =>
  playlist.value?.tracks.filter((track) => track.audio_url !== null) ?? [],
)

// Мутация (POST) выполняется только когда сессия восстановлена: guard
// обещает currentUser до входа в защищённые маршруты, но shared-страница
// публичная — дожидаемся initialized, чтобы не подписать под старой сессией.
watch(
  () => auth.initialized,
  (initialized) => {
    if (initialized && isLoggedIn.value && token.value !== null && playlist.value !== null) {
      void subscribe()
    }
  },
)

async function load(): Promise<void> {
  if (token.value === null) {
    error.value = 'Ссылка недействительна'
    return
  }

  isLoading.value = true
  error.value = null
  subscribedPlaylistId.value = null
  try {
    playlist.value = await fetchSharedPlaylist(token.value, abortGroup.nextSignal())
    // Залогиненный пользователь открывает ссылку → автоподписка (POST,
    // идемпотентный; GET состояние не меняет). Аноним просто видит список.
    if (auth.initialized && isLoggedIn.value) {
      void subscribe()
    }
  } catch {
    playlist.value = null
    error.value = 'Плейлист не найден или ссылка была отозвана'
  } finally {
    isLoading.value = false
  }
}

async function subscribe(): Promise<void> {
  if (token.value === null) {
    return
  }
  subscribedPlaylistId.value = await playlists.subscribeByToken(token.value)
}

function openPlaylist(): void {
  if (subscribedPlaylistId.value !== null) {
    void router.push({ name: 'playlist', params: { id: String(subscribedPlaylistId.value) } })
  }
}

watch(token, () => void load(), { immediate: true })

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return '—'
  }
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const secs = String(total % 60).padStart(2, '0')
  return `${minutes}:${secs}`
}
</script>

<template>
  <div class="stack shared-view">
    <div class="page-header">
      <div>
        <h1>{{ playlist?.name ?? 'Плейлист' }}</h1>
        <p v-if="playlist" class="shared-view__owner">Поделился: {{ playlist.owner_username }}</p>
      </div>
    </div>

    <LoadingState v-if="isLoading" message="Загружаем плейлист…" />

    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else-if="playlist">
      <section class="card settings-section">
        <h2 class="settings-section__title">Треки • {{ playlist.tracks.length }}</h2>

        <p v-if="playlist.tracks.length === 0" class="settings-section__empty">
          В этом плейлисте пока нет треков.
        </p>

        <ol v-else class="shared-view__tracks">
          <li v-for="(track, index) in playlist.tracks" :key="track.id" class="shared-view__track">
            <span class="shared-view__rank" aria-hidden="true">{{ index + 1 }}</span>
            <img
              v-if="track.cover_url"
              :src="track.cover_url"
              alt=""
              loading="lazy"
              decoding="async"
              class="shared-view__cover"
            >
            <span v-else class="shared-view__cover shared-view__cover--placeholder" aria-hidden="true">
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
            <span class="shared-view__info">
              <span class="shared-view__title">{{ track.title }}</span>
              <span class="shared-view__author">{{ track.author }}</span>
            </span>
            <span class="shared-view__duration">{{ formatDuration(track.duration) }}</span>
          </li>
        </ol>
      </section>

      <section v-if="!isLoggedIn" class="card settings-section shared-view__cta">
        <p>Хотите слушать? Войдите в свой аккаунт Tunegrab.</p>
        <RouterLink class="btn btn-primary" :to="{ name: 'login', query: { redirect: route.fullPath } }">
          Войти
        </RouterLink>
      </section>
      <section v-else-if="subscribedPlaylistId !== null" class="card settings-section shared-view__cta">
        <p>Плейлист добавлен в ваши плейлисты — изменения автора будут видны автоматически.</p>
        <button class="btn btn-primary" type="button" @click="openPlaylist">Открыть плейлист</button>
      </section>
      <p v-else class="settings-section__empty">
        Откройте этот плейлист в Tunegrab — треки доступны для воспроизведения.
      </p>
    </template>
  </div>
</template>
