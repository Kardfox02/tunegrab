import { flushPromises, mount } from '@vue/test-utils'
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryHistory, type Router } from 'vue-router'

import { apiClient } from '@/api/client'
import App from '@/App.vue'
import LoginView from '@/views/LoginView.vue'
import { createAppRouter } from '@/router'
import AppShell from '../AppShell.vue'

async function authenticatedAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const data = config.url === '/tracks'
    ? { items: [], total: 0, limit: 50, offset: 0 }
    : { id: 1, username: 'alice' }
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }
}

async function unauthorizedAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, {
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
    data: { detail: 'Authentication required' },
  })
}

describe('AppShell', () => {
  afterEach(() => {
    apiClient.defaults.adapter = undefined
  })

  async function mountApp(
    initialPath: string,
    adapter: typeof authenticatedAdapter,
  ): Promise<{ router: Router; wrapper: ReturnType<typeof mount> }> {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createAppRouter(pinia, createMemoryHistory())
    apiClient.defaults.adapter = adapter
    const wrapper = mount(App, {
      global: { plugins: [pinia, router] },
    })
    await router.push(initialPath)
    await flushPromises()

    return { router, wrapper }
  }

  it('renders protected pages inside the shell with navigation and user', async () => {
    const { wrapper } = await mountApp('/library', authenticatedAdapter)

    expect(wrapper.findComponent(AppShell).exists()).toBe(true)
    const links = wrapper.findAll('.app-sidebar__link')
    expect(links).toHaveLength(3)
    expect(links.every((link) => link.find('svg').exists())).toBe(true)
    expect(wrapper.get('.app-header__user').text()).toBe('alice')
  })

  it('keeps the player bar alive across protected navigation', async () => {
    const { router, wrapper } = await mountApp('/library', authenticatedAdapter)

    const playerBarBefore = wrapper.get('.player-bar').element
    await router.push('/search')
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('search')
    expect(wrapper.findComponent(AppShell).exists()).toBe(true)
    expect(wrapper.get('.player-bar').element).toBe(playerBarBefore)
  })

  it('renders guest pages without the shell', async () => {
    const { wrapper } = await mountApp('/login', unauthorizedAdapter)

    expect(wrapper.findComponent(AppShell).exists()).toBe(false)
    expect(wrapper.findComponent(LoginView).exists()).toBe(true)
  })
})
