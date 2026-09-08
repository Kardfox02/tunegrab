import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import LoginView from '../LoginView.vue'
import RegisterView from '../RegisterView.vue'
import { useAuthStore } from '@/stores/auth.store'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: LoginView },
      { path: '/register', name: 'register', component: RegisterView },
      { path: '/library', name: 'library', component: { template: '<div>library</div>' } },
      { path: '/search', name: 'search', component: { template: '<div>search</div>' } },
    ],
  })
}

describe('auth views', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('logs in and returns to the requested protected route', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    vi.spyOn(auth, 'login').mockResolvedValue({ id: 1, username: 'alice' })

    const router = createTestRouter()
    await router.push({ name: 'login', query: { redirect: '/search?q=jazz' } })
    await router.isReady()
    const wrapper = mount(LoginView, {
      global: { plugins: [pinia, router] },
    })

    await wrapper.get('#login-username').setValue('alice')
    await wrapper.get('#login-password').setValue('password')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(auth.login).toHaveBeenCalledWith({ username: 'alice', password: 'password' })
    expect(router.currentRoute.value.fullPath).toBe('/search?q=jazz')
  })

  it('shows registration errors returned by the API', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    vi.spyOn(auth, 'register').mockRejectedValue(new Error('Username is already registered'))

    const router = createTestRouter()
    await router.push({ name: 'register' })
    await router.isReady()
    const wrapper = mount(RegisterView, {
      global: { plugins: [pinia, router] },
    })

    await wrapper.get('form').trigger('submit')
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[role="alert"]').text()).toContain('Не удалось создать аккаунт')
  })
})
