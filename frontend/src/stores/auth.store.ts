import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  changePassword as changePasswordRequest,
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from '@/api/auth-api'
import { setUnauthorizedHandler } from '@/api/client'
import { isApiError, type ApiError } from '@/types/errors'
import type { ChangePasswordPayload, CredentialsPayload, User } from '@/types/auth'

export type SessionTeardown = () => void

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<User | null>(null)
  const initialized = ref(false)
  const isRestoring = ref(false)
  const pendingActions = ref(0)
  const lastError = ref<ApiError | null>(null)

  const isPending = computed(() => pendingActions.value > 0)
  const teardownCallbacks = new Set<SessionTeardown>()
  let restorePromise: Promise<void> | null = null

  function beginAction(): void {
    pendingActions.value += 1
  }

  function endAction(): void {
    pendingActions.value = Math.max(0, pendingActions.value - 1)
  }

  function clearAuthState(): void {
    currentUser.value = null
    lastError.value = null
  }

  function runSessionTeardown(): void {
    for (const teardown of teardownCallbacks) {
      try {
        teardown()
      } catch {
        // One cleanup must not prevent the remaining session cleanups.
      }
    }
  }

  function markUnauthenticated(): void {
    clearAuthState()
    runSessionTeardown()
  }

  function onSessionTeardown(teardown: SessionTeardown): () => void {
    teardownCallbacks.add(teardown)
    return () => teardownCallbacks.delete(teardown)
  }

  async function restoreSession(): Promise<void> {
    if (initialized.value) {
      return
    }

    if (restorePromise) {
      return restorePromise
    }

    restorePromise = (async () => {
      isRestoring.value = true
      beginAction()
      lastError.value = null

      try {
        currentUser.value = await getCurrentUser()
      } catch (error: unknown) {
        if (isApiError(error) && error.status === 401) {
          currentUser.value = null
          return
        }

        // Временная ошибка (сеть/5xx) не должна «залипать»: initialized
        // остаётся false, поэтому следующая навигация повторит restore.
        lastError.value = isApiError(error) ? error : null
        throw error
      } finally {
        // initialized выставляется только для определённого исхода:
        // authenticated или anonymous. После сбоя сессия будет восстановлена
        // повторно при следующей навигации.
        if (!lastError.value) {
          initialized.value = true
        }
        isRestoring.value = false
        endAction()
      }
    })()

    try {
      await restorePromise
    } finally {
      restorePromise = null
    }
  }

  async function login(credentials: CredentialsPayload): Promise<User> {
    beginAction()
    lastError.value = null

    try {
      const response = await loginRequest(credentials)
      currentUser.value = response.user
      initialized.value = true
      return response.user
    } catch (error: unknown) {
      lastError.value = isApiError(error) ? error : null
      throw error
    } finally {
      endAction()
    }
  }

  async function register(credentials: CredentialsPayload): Promise<User> {
    beginAction()
    lastError.value = null

    try {
      const response = await registerRequest(credentials)
      currentUser.value = response.user
      initialized.value = true
      return response.user
    } catch (error: unknown) {
      lastError.value = isApiError(error) ? error : null
      throw error
    } finally {
      endAction()
    }
  }

  async function logout(): Promise<void> {
    beginAction()
    lastError.value = null
    let requestError: ApiError | null = null

    try {
      await logoutRequest()
    } catch (error: unknown) {
      requestError = isApiError(error) ? error : null
      throw error
    } finally {
      markUnauthenticated()
      lastError.value = requestError
      endAction()
    }
  }

  async function changePassword(payload: ChangePasswordPayload): Promise<User> {
    beginAction()
    lastError.value = null

    try {
      const response = await changePasswordRequest(payload)
      currentUser.value = response.user
      return response.user
    } catch (error: unknown) {
      lastError.value = isApiError(error) ? error : null
      throw error
    } finally {
      endAction()
    }
  }

  setUnauthorizedHandler(() => markUnauthenticated())

  return {
    currentUser,
    initialized,
    isRestoring,
    isPending,
    lastError,
    restoreSession,
    login,
    register,
    logout,
    changePassword,
    markUnauthenticated,
    clearAuthState,
    onSessionTeardown,
  }
})
