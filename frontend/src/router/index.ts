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
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/ProfileView.vue'),
      },
      {
        // Исторический путь кабинета — оставлен redirect для старых ссылок.
        path: 'settings',
        redirect: { name: 'profile' },
      },
      {
        path: 'playlists/:id',
        name: 'playlist',
        component: () => import('@/views/PlaylistView.vue'),
      },
      {
        path: 'admin',
        name: 'admin',
        component: () => import('@/views/AdminView.vue'),
      },
    ],
  },
  {
    // Публичная страница шаринга. Не внутри AppShell: доступна без сессии.
    // API живёт на /playlists/shared/{token} (проксируется), а этот путь —
    // чисто SPA-навигация, поэтому конфликтов с proxy нет.
    path: '/shared/:token',
    name: 'shared',
    component: () => import('@/views/SharedView.vue'),
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
