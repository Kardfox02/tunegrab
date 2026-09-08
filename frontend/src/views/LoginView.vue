<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useAuthStore } from '@/stores/auth.store'
import { isApiError } from '@/types/errors'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const username = ref('')
const password = ref('')
const errorMessage = ref('')
const isSubmitting = ref(false)

function getRedirectPath(): string {
  const redirect = route.query.redirect
  if (typeof redirect !== 'string' || !redirect.startsWith('/') || redirect.startsWith('//')) {
    return '/library'
  }

  return redirect
}

async function submit(): Promise<void> {
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    await auth.login({ username: username.value, password: password.value })
    await router.replace(getRedirectPath())
  } catch (error: unknown) {
    if (isApiError(error)) {
      errorMessage.value = error.detail
    } else {
      errorMessage.value = 'Не удалось выполнить вход. Попробуйте еще раз.'
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
          <h1>С возвращением</h1>
          <p class="state-block__message">Войдите, чтобы продолжить слушать свою библиотеку.</p>
        </div>

        <form class="stack auth-form" novalidate @submit.prevent="submit">
          <div class="field">
            <label class="field-label" for="login-username">Имя пользователя</label>
            <input
              id="login-username"
              v-model.trim="username"
              class="input"
              name="username"
              autocomplete="username"
              required
              :disabled="isSubmitting"
            >
          </div>

          <div class="field">
            <label class="field-label" for="login-password">Пароль</label>
            <input
              id="login-password"
              v-model="password"
              class="input"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              :disabled="isSubmitting"
            >
          </div>

          <p v-if="errorMessage" class="auth-error" role="alert">{{ errorMessage }}</p>

          <button class="btn btn-primary" type="submit" :disabled="isSubmitting">
            {{ isSubmitting ? 'Входим...' : 'Войти' }}
          </button>
        </form>

        <p class="auth-link">Нет аккаунта? <RouterLink to="/register">Зарегистрироваться</RouterLink></p>
      </div>
    </section>
  </main>
</template>
