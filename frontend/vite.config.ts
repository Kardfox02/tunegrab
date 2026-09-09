/// <reference types="vitest/config" />

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 8080,
    strictPort: true,
    allowedHosts: ['rknshit.com'],
    proxy: {
      '/auth': 'http://localhost:8000',
      '/tracks': 'http://localhost:8000',
      '/youtube': 'http://localhost:8000',
      '/stream': 'http://localhost:8000',
      '/covers': 'http://localhost:8000',
      '/events': 'http://localhost:8000',
      '/likes': 'http://localhost:8000',
      // API и SPA-страницы живут на одном префиксе /playlists: axios шлёт
      // Accept: application/json (проксируем), браузерная навигация —
      // Accept: text/html (отдаём index.html, иначе перезагрузка страницы
      // плейлиста упирается в FastAPI и показывает JSON 404).
      '/playlists': {
        target: 'http://localhost:8000',
        bypass(req) {
          if (req.headers.accept?.includes('text/html')) {
            return '/index.html'
          }
          return undefined
        },
      },
      '/admin/health': 'http://localhost:8000',
      '/admin/thumbnails': 'http://localhost:8000',
      '/admin/commands': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
