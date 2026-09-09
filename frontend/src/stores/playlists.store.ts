import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  addPlaylistTrack,
  createPlaylist,
  createShareLink,
  deletePlaylist,
  fetchPlaylist,
  fetchPlaylists,
  removePlaylistTrack,
  renamePlaylist,
  reorderPlaylistTracks,
  revokeShareLink,
  subscribeToSharedPlaylist,
  unsubscribeFromPlaylist,
} from '@/api/playlists-api'
import { useAuthStore } from '@/stores/auth.store'
import { useNotificationsStore } from '@/stores/notifications.store'
import { isApiError } from '@/types/errors'
import type { PlaylistDetail, PlaylistSummary } from '@/types/playlists'
import type { Track } from '@/types/track'

export const usePlaylistsStore = defineStore('playlists', () => {
  const auth = useAuthStore()
  const notifications = useNotificationsStore()

  const playlists = ref<PlaylistSummary[]>([])
  const isLoading = ref(false)
  const isLoaded = ref(false)
  const listError = ref<string | null>(null)

  // Детальная страница плейлиста. Хранится по id, чтобы возврат на страницу
  // не требовал повторной загрузки, а мутации обновляли её на месте.
  const detail = ref<PlaylistDetail | null>(null)
  const isDetailLoading = ref(false)
  const detailError = ref<string | null>(null)

  const hasPlaylists = computed(() => playlists.value.length > 0)
  const detailTracks = computed<Track[]>(() => detail.value?.items ?? [])

  async function load(force = false): Promise<void> {
    if (isLoaded.value && !force) {
      return
    }

    isLoading.value = true
    listError.value = null
    try {
      const response = await fetchPlaylists()
      playlists.value = response.items
      isLoaded.value = true
    } catch {
      listError.value = 'Не удалось загрузить плейлисты'
    } finally {
      isLoading.value = false
    }
  }

  async function loadDetail(id: number, force = false): Promise<void> {
    if (!force && detail.value?.id === id) {
      return
    }

    isDetailLoading.value = true
    detailError.value = null
    try {
      detail.value = await fetchPlaylist(id)
    } catch {
      detailError.value = 'Не удалось загрузить плейлист'
    } finally {
      isDetailLoading.value = false
    }
  }

  async function create(name: string): Promise<PlaylistSummary | null> {
    try {
      const created = await createPlaylist(name)
      playlists.value = [...playlists.value, created]
      isLoaded.value = true
      notifications.push(`Плейлист «${created.name}» создан`, 'success')
      return created
    } catch (error: unknown) {
      const detailMessage = isApiError(error) ? error.detail : null
      notifications.push(detailMessage ?? 'Не удалось создать плейлист', 'error')
      return null
    }
  }

  async function rename(id: number, name: string): Promise<boolean> {
    try {
      const updated = await renamePlaylist(id, name)
      if (detail.value?.id === id) {
        detail.value = updated
      }
      playlists.value = playlists.value.map((item) =>
        item.id === id ? { ...item, name: updated.name } : item,
      )
      return true
    } catch (error: unknown) {
      const detailMessage = isApiError(error) ? error.detail : null
      notifications.push(detailMessage ?? 'Не удалось переименовать плейлист', 'error')
      return false
    }
  }

  async function remove(id: number): Promise<boolean> {
    try {
      await deletePlaylist(id)
      playlists.value = playlists.value.filter((item) => item.id !== id)
      if (detail.value?.id === id) {
        detail.value = null
      }
      notifications.push('Плейлист удалён', 'success')
      return true
    } catch {
      notifications.push('Не удалось удалить плейлист', 'error')
      return false
    }
  }

  async function addTrack(playlistId: number, trackId: number): Promise<boolean> {
    try {
      const updated = await addPlaylistTrack(playlistId, trackId)
      if (detail.value?.id === playlistId) {
        detail.value = updated
      }
      playlists.value = playlists.value.map((item) =>
        item.id === playlistId ? { ...item, track_count: updated.items.length } : item,
      )
      notifications.push('Трек добавлен в плейлист', 'success')
      return true
    } catch (error: unknown) {
      const detailMessage = isApiError(error) ? error.detail : null
      notifications.push(detailMessage ?? 'Не удалось добавить трек', 'error')
      return false
    }
  }

  async function removeTrack(playlistId: number, trackId: number): Promise<boolean> {
    try {
      await removePlaylistTrack(playlistId, trackId)
      if (detail.value?.id === playlistId) {
        const items = detail.value.items.filter((track) => track.id !== trackId)
        detail.value = { ...detail.value, items }
        syncTrackCount(playlistId, items.length)
      }
      return true
    } catch {
      notifications.push('Не удалось удалить трек из плейлиста', 'error')
      return false
    }
  }

  // Оптимистичный reorder: порядок применяется сразу, при ошибке — откат и тост.
  async function reorder(playlistId: number, orderedTracks: Track[]): Promise<boolean> {
    const previous = detail.value
    if (!previous || previous.id !== playlistId) {
      return false
    }

    const previousItems = previous.items
    detail.value = { ...previous, items: orderedTracks }

    try {
      const updated = await reorderPlaylistTracks(
        playlistId,
        orderedTracks.map((track) => track.id),
      )
      detail.value = updated
      return true
    } catch {
      detail.value = { ...previous, items: previousItems }
      notifications.push('Не удалось изменить порядок', 'error')
      return false
    }
  }

  async function share(playlistId: number): Promise<string | null> {
    try {
      const updated = await createShareLink(playlistId)
      playlists.value = playlists.value.map((item) =>
        item.id === playlistId ? { ...item, share_url: updated.share_url } : item,
      )
      if (detail.value?.id === playlistId) {
        detail.value = { ...detail.value, share_url: updated.share_url }
      }
      return updated.share_url
    } catch {
      notifications.push('Не удалось создать ссылку', 'error')
      return null
    }
  }

  async function revokeShare(playlistId: number): Promise<boolean> {
    try {
      await revokeShareLink(playlistId)
      playlists.value = playlists.value.map((item) =>
        item.id === playlistId ? { ...item, share_url: null } : item,
      )
      if (detail.value?.id === playlistId) {
        detail.value = { ...detail.value, share_url: null }
      }
      return true
    } catch {
      notifications.push('Не удалось отозвать ссылку', 'error')
      return false
    }
  }

  function syncTrackCount(playlistId: number, count: number): void {
    playlists.value = playlists.value.map((item) =>
      item.id === playlistId ? { ...item, track_count: count } : item,
    )
  }

  // Автоподписка по share-токену (идемпотентно). Возвращает id плейлиста
  // или null (плейлист не найден / ссылка отозвана).
  async function subscribeByToken(token: string): Promise<number | null> {
    try {
      return await subscribeToSharedPlaylist(token)
    } catch {
      return null
    }
  }

  // Отписка от чужого плейлиста: убирает плитку и detail локально после 204.
  async function unsubscribe(playlistId: number): Promise<boolean> {
    try {
      await unsubscribeFromPlaylist(playlistId)
      playlists.value = playlists.value.filter((item) => item.id !== playlistId)
      if (detail.value?.id === playlistId) {
        detail.value = null
      }
      notifications.push('Вы отписались от плейлиста', 'success')
      return true
    } catch {
      notifications.push('Не удалось отписаться', 'error')
      return false
    }
  }

  function reset(): void {
    playlists.value = []
    detail.value = null
    isLoading.value = false
    isLoaded.value = false
    listError.value = null
    isDetailLoading.value = false
    detailError.value = null
  }

  auth.onSessionTeardown(reset)

  return {
    playlists,
    isLoading,
    isLoaded,
    listError,
    detail,
    isDetailLoading,
    detailError,
    hasPlaylists,
    detailTracks,
    load,
    loadDetail,
    create,
    rename,
    remove,
    addTrack,
    removeTrack,
    reorder,
    share,
    revokeShare,
    subscribeByToken,
    unsubscribe,
    reset,
  }
})
