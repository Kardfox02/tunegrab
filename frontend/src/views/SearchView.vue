<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { searchYouTube } from '@/api/youtube-api'
import { uploadTrack } from '@/api/tracks-api'
import EmptyState from '@/components/EmptyState.vue'
import ErrorState from '@/components/ErrorState.vue'
import SearchForm from '@/components/SearchForm.vue'
import YouTubeResultCard from '@/components/YouTubeResultCard.vue'
import { useDebouncedSearch } from '@/composables/useDebouncedSearch'
import { useDownloadsStore } from '@/stores/downloads.store'
import { useLibraryStore } from '@/stores/library.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { isApiError } from '@/types/errors'
import type { YouTubeSearchResult } from '@/types/youtube'

const SEARCH_LIMIT = 10

const downloads = useDownloadsStore()
const library = useLibraryStore()
const notifications = useNotificationsStore()

const {
  query,
  results,
  isLoading,
  error,
  hasSearched,
  schedule,
  submit,
} = useDebouncedSearch<YouTubeSearchResult>({
  search: (searchQuery, signal) =>
    searchYouTube(searchQuery, SEARCH_LIMIT, signal).then((response) => response.items),
})

watch(query, () => schedule())

const downloadError = ref<{ id: string; message: string } | null>(null)

function errorFor(result: YouTubeSearchResult): string | null {
  return downloadError.value?.id === result.youtube_id ? downloadError.value.message : null
}

async function download(result: YouTubeSearchResult): Promise<void> {
  downloadError.value = null

  try {
    await downloads.queueDownload(result)
  } catch (cause: unknown) {
    downloadError.value = {
      id: result.youtube_id,
      message: isApiError(cause) ? cause.detail : 'Не удалось поставить трек в очередь',
    }
  }
}

const liveMessage = computed(() => {
  if (isLoading.value) {
    return 'Выполняется поиск'
  }
  if (error.value) {
    return 'Поиск завершился ошибкой'
  }
  if (hasSearched.value) {
    return `Найдено результатов: ${results.value.length}`
  }
  return ''
})

const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)

function triggerUpload(): void {
  fileInput.value?.click()
}

function onFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) {
    void upload(file)
  }
}

async function upload(file: File): Promise<void> {
  if (isUploading.value) {
    return
  }
  isUploading.value = true
  try {
    await uploadTrack(file)
    // Библиотека — общая и могла быть загружена ранее в этой сессии;
    // обновляем её, чтобы трек появился без перехода на /library.
    if (library.isInitialized) {
      await library.load()
    }
    notifications.push('Трек добавлен в библиотеку', 'success')
  } catch (cause: unknown) {
    notifications.push(
      isApiError(cause) ? cause.detail : 'Не удалось загрузить трек',
      'error',
    )
  } finally {
    isUploading.value = false
  }
}
</script>

<template>
  <div class="stack search-view">
    <div class="page-header">
      <div>
        <h1>Поиск</h1>
        <p class="search-view__hint">Найдите трек на YouTube и добавьте его в библиотеку.</p>
      </div>
    </div>

    <SearchForm v-model="query" @submit="submit" />

    <p class="visually-hidden" aria-live="polite">{{ liveMessage }}</p>

    <div v-if="!hasSearched" class="card state-block">
      <p class="state-block__message">Введите минимум 2 символа — например, исполнителя или название трека.</p>
    </div>

    <div v-else-if="isLoading" class="state-block" aria-hidden="true">
      <div class="spinner"></div>
    </div>

    <ErrorState
      v-else-if="error"
      :message="error.detail"
      @retry="submit"
    />

    <EmptyState
      v-else-if="results.length === 0"
      title="Ничего не найдено"
      message="Попробуйте изменить запрос — возможно, трек называется иначе."
    />

    <div v-else class="search-grid">
      <YouTubeResultCard
        v-for="result in results"
        :key="result.youtube_id"
        :result="result"
        :download-state="downloads.stateForResult(result.youtube_id)"
        :active-track="downloads.activeTrackFor(result.youtube_id)"
        :error-message="errorFor(result)"
        @download="download(result)"
      />
    </div>

    <div class="search-view__upload">
      <input
        ref="fileInput"
        class="visually-hidden"
        type="file"
        accept="audio/mpeg,.mp3"
        aria-hidden="true"
        tabindex="-1"
        @change="onFileSelected"
      >
      <button
        class="btn btn-secondary"
        type="button"
        :disabled="isUploading"
        @click="triggerUpload"
      >
        <span v-if="isUploading" class="spinner" aria-hidden="true"></span>
        {{ isUploading ? 'Загрузка…' : 'Загрузить свой трек' }}
      </button>
    </div>
  </div>
</template>
