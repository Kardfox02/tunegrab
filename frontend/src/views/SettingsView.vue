<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import LoadingState from '@/components/LoadingState.vue'
import TrackList from '@/components/TrackList.vue'
import { createPolling } from '@/composables/usePolling'
import { useInfiniteScroll } from '@/composables/useInfiniteScroll'
import { useAuthStore } from '@/stores/auth.store'
import { usePlayerStore } from '@/stores/player.store'
import { useProfileStore } from '@/stores/profile.store'
import type { Track } from '@/types/track'

const auth = useAuthStore()
const player = usePlayerStore()
const profile = useProfileStore()

// Период статистики: 24 часа / 7 дней / 30 дней. Выбранный период держим
// локально — он влияет и на ручное обновление, и на поллинг.
const STATS_PERIODS = [
  { days: 1, label: '24 часа', title: 'Статистика за 24 часа' },
  { days: 7, label: '7 дней', title: 'Статистика за 7 дней' },
  { days: 30, label: '30 дней', title: 'Статистика за 30 дней' },
] as const
const statsPeriodDays = ref<number>(7)
const statsSectionTitle = computed(
  () => STATS_PERIODS.find((period) => period.days === statsPeriodDays.value)?.title
    ?? 'Статистика',
)

function selectStatsPeriod(days: number): void {
  if (statsPeriodDays.value === days) {
    return
  }
  statsPeriodDays.value = days
  void profile.refreshStats(days)
}

// Статистика обновляется сама, пока открыт кабинет: опрос 30 с (в фоновой
// вкладке реже) + мгновенный тик при возврате на вкладку. Первый тик не нужен —
// reloadProfile() при маунте уже грузит статистику.
const statsPolling = createPolling(
  () => profile.refreshStats(statsPeriodDays.value),
  { intervalMs: 30000, runOnStart: false },
)

onMounted(() => {
  // Каждый переход в профиль — свежая статистика и лайки.
  void profile.reloadProfile()
  statsPolling.start()
})

onUnmounted(() => {
  statsPolling.stop()
})

const greetingLabel = computed(() =>
  auth.currentUser ? `Привет, ${auth.currentUser.username}` : 'Личный кабинет',
)

async function logout(): Promise<void> {
  try {
    await auth.logout()
  } catch {
    // Teardown выполняется даже при ошибке запроса — редирект на /login
    // делает router через session teardown.
  }
}

function formatListenedTime(seconds: number): string {
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) {
    return `${minutes} мин`
  }
  return `${hours} ч ${minutes} мин`
}

const stats = computed(() => profile.stats)

function playFromLikes(track: Track): void {
  player.playOrToggle(track, profile.likedTracks)
}

function toggleLike(track: Track): void {
  void profile.toggleLike(track)
}

// Пагинация «Любимого» — как в библиотеке: сентинел + серверные партии.
const likesSentinel = ref<HTMLElement | null>(null)

useInfiniteScroll({
  target: likesSentinel,
  onIntersect: () => void profile.loadNextLikes(),
  isDisabled: () =>
    !profile.isLoaded || profile.isLoadingLikes || !profile.hasMoreLikes || profile.isLoadingLikesNextPage,
})
</script>

<template>
  <div class="stack settings-view">
    <div class="page-header">
      <div>
        <h1>{{ greetingLabel }}</h1>
      </div>
      <button class="btn btn-secondary settings-view__logout" type="button" @click="logout">
        Выйти
      </button>
    </div>

    <section class="card settings-section" aria-labelledby="settings-stats">
      <div class="settings-section__header">
        <h2 id="settings-stats" class="settings-section__title">{{ statsSectionTitle }}</h2>
        <div class="stats-period" role="group" aria-label="Период статистики">
          <button
            v-for="period in STATS_PERIODS"
            :key="period.days"
            type="button"
            class="stats-period__option"
            :class="{ 'stats-period__option--active': statsPeriodDays === period.days }"
            :aria-pressed="statsPeriodDays === period.days"
            @click="selectStatsPeriod(period.days)"
          >
            {{ period.label }}
          </button>
        </div>
      </div>

      <LoadingState v-if="profile.isStatsLoading && !profile.stats" message="Загружаем статистику…" />

      <ErrorState
        v-else-if="profile.statsError"
        :message="profile.statsError"
        @retry="profile.refreshStats()"
      />

      <template v-else-if="stats">
        <div class="stats-grid" role="group" aria-label="Счётчики прослушиваний">
          <div class="stats-cell">
            <span class="stats-cell__value">{{ stats.play_count ?? 0 }}</span>
            <span class="stats-cell__label">запусков</span>
          </div>
          <div class="stats-cell">
            <span class="stats-cell__value">{{ stats.complete_count ?? 0 }}</span>
            <span class="stats-cell__label">дослушано</span>
          </div>
          <div class="stats-cell">
            <span class="stats-cell__value">{{ stats.skip_count ?? 0 }}</span>
            <span class="stats-cell__label">пропущено</span>
          </div>
          <div class="stats-cell">
            <span class="stats-cell__value">{{ formatListenedTime(stats.listened_seconds ?? 0) }}</span>
            <span class="stats-cell__label">время</span>
          </div>
        </div>

        <div v-if="(stats.top_tracks?.length ?? 0) > 0" class="stats-top">
          <h3 class="stats-top__title">Топ треков</h3>
          <ol class="stats-top__list">
            <li v-for="(entry, index) in stats.top_tracks" :key="entry.track.id" class="stats-top__row">
              <span class="stats-top__rank" aria-hidden="true">{{ index + 1 }}</span>
              <img
                v-if="entry.track.cover_url"
                :src="entry.track.cover_url"
                alt=""
                loading="lazy"
                decoding="async"
                class="stats-top__cover"
              >
              <span v-else class="stats-top__cover stats-top__cover--placeholder" aria-hidden="true"></span>
              <span class="stats-top__info">
                <span class="stats-top__track">{{ entry.track.title }}</span>
                <span class="stats-top__author">{{ entry.track.author }}</span>
              </span>
            </li>
          </ol>
        </div>
        <p v-else class="settings-section__empty">Слушайте музыку — статистика появится здесь.</p>
      </template>
    </section>

    <section class="card settings-section settings-section--placeholder" aria-labelledby="settings-playlists">
      <h2 id="settings-playlists" class="settings-section__title">Плейлисты</h2>
      <p class="settings-section__empty">Появится скоро</p>
    </section>

    <section class="card settings-section" aria-labelledby="settings-likes">
      <h2 id="settings-likes" class="settings-section__title">
        Любимое •
        <span v-if="profile.likesTotal > 0" class="settings-section__counter">{{ profile.likesTotal }}</span>
      </h2>

      <LoadingState v-if="profile.isLoadingLikes && profile.likedTracks.length === 0" message="Загружаем любимые треки…" />

      <ErrorState
        v-else-if="profile.likesError && profile.likedTracks.length === 0"
        :message="profile.likesError"
        @retry="profile.refreshLikes()"
      />

      <template v-else-if="profile.hasLikes">
        <TrackList
          :tracks="profile.likedTracks"
          :deleting-ids="[]"
          :delete-error="null"
          :current-track-id="player.currentTrack?.id ?? null"
          :is-playing="player.isPlaying"
          :liked-track-ids="profile.likedTrackIds"
          :toggling-like-ids="profile.togglingIds"
          @play="playFromLikes"
          @toggle-like="toggleLike"
        />

        <div
          v-if="profile.hasMoreLikes"
          ref="likesSentinel"
          class="library-view__sentinel"
        >
          <span v-if="profile.isLoadingLikesNextPage" class="spinner" aria-hidden="true"></span>
          <span class="visually-hidden" aria-live="polite">
            {{ profile.isLoadingLikesNextPage ? 'Загружаем еще треки' : '' }}
          </span>
        </div>
      </template>

      <EmptyState
        v-else
        title="Пока пусто"
        message="Отмечайте треки сердечком в библиотеке — они появятся здесь."
      />
    </section>
  </div>
</template>
