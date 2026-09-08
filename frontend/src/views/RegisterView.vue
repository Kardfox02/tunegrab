<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth.store'
import { isApiError } from '@/types/errors'

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const password = ref('')
const errorMessage = ref('')
const isSubmitting = ref(false)

async function submit(): Promise<void> {
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    await auth.register({ username: username.value, password: password.value })
    await router.replace({ name: 'library' })
  } catch (error: unknown) {
    if (isApiError(error)) {
      errorMessage.value = error.detail
    } else {
      errorMessage.value = 'Не удалось создать аккаунт. Попробуйте еще раз.'
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <main class="app-layout">
    <section class="page">
      <div class="card auth-card">
        <div class="stack">
          <p class="field-label">Tunegrab</p>
          <h1>Создайте аккаунт</h1>
          <p class="state-block__message">Соберите личную библиотеку музыки без лишнего шума.</p>
        </div>

        <form class="stack auth-form" novalidate @submit.prevent="submit">
          <div class="field">
            <label class="field-label" for="register-username">Имя пользователя</label>
            <input
              id="register-username"
              v-model.trim="username"
              class="input"
              name="username"
              autocomplete="username"
              required
              :disabled="isSubmitting"
            >
          </div>

          <div class="field">
            <label class="field-label" for="register-password">Пароль</label>
            <input
              id="register-password"
              v-model="password"
              class="input"
              type="password"
              name="password"
              autocomplete="new-password"
              required
              :disabled="isSubmitting"
            >
          </div>

          <p v-if="errorMessage" class="auth-error" role="alert">{{ errorMessage }}</p>

          <button class="btn btn-primary" type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? 'Создаем...' : 'Создать аккаунт' }}
          </button>
        </form>

        <p class="auth-link">Уже есть аккаунт? <RouterLink to="/login">Войти</RouterLink></p>
      </div>
    </section>
  </main>
</template>
