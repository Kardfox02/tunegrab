<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import StorageDonutChart from '@/components/StorageDonutChart.vue'
import ErrorState from '@/components/ErrorState.vue'
import LoadingState from '@/components/LoadingState.vue'
import { changePassword } from '@/api/auth-api'
import {
  clearThumbnails,
  fetchAdminHealth,
  runCleanupOrphans,
  runVerifyStorage,
} from '@/api/admin-api'
import { useAuthStore } from '@/stores/auth.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { isApiError } from '@/types/errors'
import type {
  AdminHealth,
  CleanupOrphansResponse,
  VerifyStorageResponse,
} from '@/types/admin'

const auth = useAuthStore()
const notifications = useNotificationsStore()

// ── Аккаунт: смена пароля ────────────────────────────────────────────────

// Форма скрыта по умолчанию — смена пароля нужна редко.
const isPasswordFormOpen = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const repeatedPassword = ref('')
const passwordError = ref('')
const isChangingPassword = ref(false)
const PASSWORD_MIN_LENGTH = 8

async function submitPasswordChange(): Promise<void> {
  passwordError.value = ''
  if (newPassword.value.length < PASSWORD_MIN_LENGTH) {
    passwordError.value = `Новый пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов.`
    return
  }
  if (newPassword.value !== repeatedPassword.value) {
    passwordError.value = 'Пароли не совпадают.'
    return
  }

  isChangingPassword.value = true
  try {
    await changePassword({
      current_password: currentPassword.value,
      new_password: newPassword.value,
    })
    currentPassword.value = ''
    newPassword.value = ''
    repeatedPassword.value = ''
    notifications.push('Пароль изменён', 'success')
  } catch (error: unknown) {
    if (isApiError(error)) {
      passwordError.value = error.status === 401
        ? 'Текущий пароль неверен.'
        : error.detail
    } else {
      passwordError.value = 'Не удалось изменить пароль. Попробуйте еще раз.'
    }
  } finally {
    isChangingPassword.value = false
  }
}

// ── Состояние сервера ────────────────────────────────────────────────────

const health = ref<AdminHealth | null>(null)
const healthError = ref('')
const isLoadingHealth = ref(false)

async function loadHealth(): Promise<void> {
  healthError.value = ''
  isLoadingHealth.value = true
  try {
    const data = await fetchAdminHealth()
    // Мусорный ответ (HTML от SPA-fallback, обрезанный JSON и т.п.) →
    // ошибка секции, а не падение рендера диаграммы.
    if (
      data === null || typeof data !== 'object' ||
      typeof data.track_count !== 'number' ||
      typeof data.disk_free_bytes !== 'number' ||
      data.storage === null || typeof data.storage !== 'object' ||
      typeof data.storage.total_bytes !== 'number'
    ) {
      healthError.value = 'Сервер вернул некорректный ответ.'
      return
    }
    health.value = data
  } catch {
    healthError.value = 'Не удалось загрузить состояние сервера.'
  } finally {
    isLoadingHealth.value = false
  }
}

const greetingLabel = computed(() =>
  auth.currentUser ? `Панель управления · ${auth.currentUser.username}` : 'Панель управления',
)

// ── Обслуживание: команды и очистка превью ───────────────────────────────

const verifyResult = ref<VerifyStorageResponse | null>(null)
const cleanupResult = ref<CleanupOrphansResponse | null>(null)
const thumbnailsResult = ref<{ deleted: number; freed: string } | null>(null)
const busyCommand = ref<'verify' | 'cleanup' | 'thumbnails' | null>(null)

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} Б`
  }
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ']
  let value = bytes
  let unitIndex = -1
  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`
}

async function executeVerifyStorage(): Promise<void> {
  busyCommand.value = 'verify'
  verifyResult.value = null
  try {
    verifyResult.value = await runVerifyStorage()
  } catch {
    notifications.push('Не удалось выполнить проверку хранилища', 'error')
  } finally {
    busyCommand.value = null
  }
}

async function executeCleanupOrphans(): Promise<void> {
  const confirmed = window.confirm(
    'Удалить файлы в downloads/, на которые не ссылается ни один трек? Действие необратимо.',
  )
  if (!confirmed) {
    return
  }
  busyCommand.value = 'cleanup'
  cleanupResult.value = null
  try {
    cleanupResult.value = await runCleanupOrphans()
    if (cleanupResult.value.deleted_count === 0) {
      notifications.push('Сирот-файлов нет', 'info')
    } else {
      notifications.push(`Удалено файлов: ${cleanupResult.value.deleted_count}`, 'success')
    }
    void loadHealth()
  } catch {
    notifications.push('Не удалось выполнить очистку сирот-файлов', 'error')
  } finally {
    busyCommand.value = null
  }
}

async function executeThumbnailsClear(): Promise<void> {
  const confirmed = window.confirm(
    'Удалить весь кэш превью YouTube? Превью скачаются заново по мере необходимости.',
  )
  if (!confirmed) {
    return
  }
  busyCommand.value = 'thumbnails'
  thumbnailsResult.value = null
  try {
    const response = await clearThumbnails()
    thumbnailsResult.value = {
      deleted: response.deleted_files,
      freed: formatBytes(response.freed_bytes),
    }
    if (response.deleted_files === 0) {
      notifications.push('Кэш превью уже пуст', 'info')
    } else {
      notifications.push(`Удалено превью: ${response.deleted_files}`, 'success')
    }
    void loadHealth()
  } catch {
    notifications.push('Не удалось очистить кэш превью', 'error')
  } finally {
    busyCommand.value = null
  }
}

onMounted(() => {
  void loadHealth()
})
</script>

<template>
  <div class="stack admin-view">
    <div class="page-header">
      <div>
        <h1>{{ greetingLabel }}</h1>
      </div>
    </div>

    <section class="card settings-section" aria-labelledby="admin-account">
      <button
        id="admin-account"
        type="button"
        class="admin-toggle"
        :aria-expanded="isPasswordFormOpen"
        aria-controls="admin-password-form"
        @click="isPasswordFormOpen = !isPasswordFormOpen"
      >
        <h2 class="settings-section__title">Аккаунт</h2>
        <span class="admin-toggle__chevron" :class="{ 'admin-toggle__chevron--open': isPasswordFormOpen }" aria-hidden="true"></span>
      </button>
      <div v-show="isPasswordFormOpen" id="admin-password-form">
        <form class="stack admin-form" novalidate @submit.prevent="submitPasswordChange">
        <div class="field">
          <label class="field-label" for="admin-current-password">Текущий пароль</label>
          <input
            id="admin-current-password"
            v-model="currentPassword"
            class="input"
            type="password"
            name="current-password"
            autocomplete="current-password"
            required
            :disabled="isChangingPassword"
          >
        </div>

        <div class="field">
          <label class="field-label" for="admin-new-password">Новый пароль</label>
          <input
            id="admin-new-password"
            v-model="newPassword"
            class="input"
            type="password"
            name="new-password"
            autocomplete="new-password"
            minlength="8"
            required
            :disabled="isChangingPassword"
          >
        </div>

        <div class="field">
          <label class="field-label" for="admin-repeat-password">Повторите новый пароль</label>
          <input
            id="admin-repeat-password"
            v-model="repeatedPassword"
            class="input"
            type="password"
            name="new-password-confirm"
            autocomplete="new-password"
            required
            :disabled="isChangingPassword"
          >
        </div>

        <p v-if="passwordError" class="admin-form__error" role="alert">{{ passwordError }}</p>

        <button class="btn btn-primary" type="submit" :disabled="isChangingPassword">
          {{ isChangingPassword ? 'Сохраняем...' : 'Сменить пароль' }}
        </button>
        </form>
      </div>
    </section>

    <section class="card settings-section" aria-labelledby="admin-health">
      <h2 id="admin-health" class="settings-section__title">Состояние сервера</h2>

      <LoadingState v-if="isLoadingHealth && !health" message="Загружаем состояние сервера…" />

      <ErrorState v-else-if="healthError && !health" :message="healthError" @retry="loadHealth" />

      <template v-else-if="health">
        <div class="admin-health">
          <StorageDonutChart :storage="health.storage" :disk-free-bytes="health.disk_free_bytes" />
          <ul class="admin-health__facts">
            <li class="admin-health__fact">
              <span class="admin-health__fact-label">Треков в библиотеке</span>
              <span class="admin-health__fact-value">{{ health.track_count }}</span>
            </li>
            <li class="admin-health__fact">
              <span class="admin-health__fact-label">Директории хранилища</span>
              <span
                class="admin-health__fact-value"
                :class="health.storage_ok ? 'admin-health__fact-value--ok' : 'admin-health__fact-value--warn'"
              >
                {{ health.storage_ok ? 'в порядке' : 'проблема' }}
              </span>
            </li>
            <li class="admin-health__fact">
              <span class="admin-health__fact-label">Свободно на диске</span>
              <span class="admin-health__fact-value">{{ formatBytes(health.disk_free_bytes) }}</span>
            </li>
            <li class="admin-health__fact">
              <span class="admin-health__fact-label">ffmpeg</span>
              <span
                class="admin-health__fact-value"
                :class="health.ffmpeg_found ? 'admin-health__fact-value--ok' : 'admin-health__fact-value--warn'"
              >
                {{ health.ffmpeg_found ? 'доступен' : 'не найден' }}
              </span>
            </li>
          </ul>
        </div>
      </template>
    </section>

    <section class="card settings-section" aria-labelledby="admin-maintenance">
      <h2 id="admin-maintenance" class="settings-section__title">Обслуживание</h2>

      <div class="admin-actions">
        <div class="admin-action">
          <div class="admin-action__info">
            <span class="admin-action__name">Очистить кэш превью</span>
            <span class="admin-action__hint">Удаляет скачанные превью YouTube, освобождая место.</span>
          </div>
          <button
            class="btn btn-secondary"
            type="button"
            :disabled="busyCommand !== null"
            @click="executeThumbnailsClear"
          >
            {{ busyCommand === 'thumbnails' ? 'Очищаем...' : 'Очистить' }}
          </button>
        </div>
        <p v-if="thumbnailsResult" class="admin-action__result" role="status">
          Удалено файлов: {{ thumbnailsResult.deleted }} · освобождено {{ thumbnailsResult.freed }}
        </p>

        <div class="admin-action">
          <div class="admin-action__info">
            <span class="admin-action__name">Проверить хранилище</span>
            <span class="admin-action__hint">Аналог CLI verify-storage: целостность файлов и директорий.</span>
          </div>
          <button
            class="btn btn-secondary"
            type="button"
            :disabled="busyCommand !== null"
            @click="executeVerifyStorage"
          >
            {{ busyCommand === 'verify' ? 'Проверяем...' : 'Проверить' }}
          </button>
        </div>
        <p
          v-if="verifyResult"
          class="admin-action__result"
          :class="{ 'admin-action__result--error': !verifyResult.ok }"
          role="status"
        >
          <template v-if="verifyResult.ok">Проверка пройдена: ошибок нет.</template>
          <template v-else>{{ verifyResult.errors.join('; ') }}</template>
        </p>

        <div class="admin-action">
          <div class="admin-action__info">
            <span class="admin-action__name">Очистить сироты-файлы</span>
            <span class="admin-action__hint">Аналог CLI cleanup-orphans: удаляет файлы без треков в БД.</span>
          </div>
          <button
            class="btn btn-secondary"
            type="button"
            :disabled="busyCommand !== null"
            @click="executeCleanupOrphans"
          >
            {{ busyCommand === 'cleanup' ? 'Очищаем...' : 'Очистить' }}
          </button>
        </div>
        <p v-if="cleanupResult && cleanupResult.deleted_count > 0" class="admin-action__result" role="status">
          Удалено файлов: {{ cleanupResult.deleted_count }} ({{ cleanupResult.files.join(', ') }})
        </p>
      </div>
    </section>
  </div>
</template>
