import {
  createRouter,
  createWebHistory,
  type Router,
  type RouterHistory,
} from 'vue-router'
import type { Pinia } from 'pinia'

import { useAuthStore } from '@/stores/auth.store'
import { useDownloadsStore } from '@/stores/downloads.store'

const routes = [
  {
    path: '/',
    component: () => import('@/components/AppShell.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        redirect: { name: 'library' },
      },
      {
        path: 'library',
        name: 'library',
        component: () => import('@/views/LibraryView.vue'),
      },
      {
        path: 'search',
        name: 'search',
        component: () => import('@/views/SearchView.vue'),
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/SettingsView.vue'),
      },
    ],
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { guestOnly: true },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { guestOnly: true },
  },
]

export function createAppRouter(
  pinia: Pinia,
  history: RouterHistory = createWebHistory(import.meta.env.BASE_URL),
): Router {
  const router = createRouter({
    history,
    routes,
  })
  const auth = useAuthStore(pinia)

  auth.onSessionTeardown(() => {
    if (router.currentRoute.value.name !== 'login') {
      void router.push({ name: 'login' })
    }
  })

  router.beforeEach(async (to) => {
    try {
      await auth.restoreSession()
    } catch {
      // Сетевой сбой при восстановлении сессии: initialized остался false,
      // поэтому следующая навигация повторит попытку. Не роняем навигацию.
      if (to.meta.requiresAuth) {
        return {
          name: 'login',
          query: { redirect: to.fullPath },
        }
      }
      return true
    }

    if (auth.currentUser) {
      const downloads = useDownloadsStore(pinia)
      if (!downloads.isRestored) {
        void downloads.restore()
      }
    }

    if (to.meta.requiresAuth && !auth.currentUser) {
      return {
        name: 'login',
        query: { redirect: to.fullPath },
      }
    }

    if (to.meta.guestOnly && auth.currentUser) {
      return { name: 'library' }
    }

    return true
  })

  return router
}
