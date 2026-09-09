import { apiClient } from './client'
import type { PlaylistDetail, PlaylistListResponse, PlaylistSummary, SharedPlaylist } from '@/types/playlists'

export async function fetchPlaylists(signal?: AbortSignal): Promise<PlaylistListResponse> {
  const response = await apiClient.get<PlaylistListResponse>('/playlists', { signal })
  if (!Array.isArray(response.data?.items)) {
    throw new Error('Malformed playlists response')
  }
  return response.data
}

export async function createPlaylist(name: string): Promise<PlaylistSummary> {
  const response = await apiClient.post<PlaylistSummary>('/playlists', { name })
  return response.data
}

export async function fetchPlaylist(id: number, signal?: AbortSignal): Promise<PlaylistDetail> {
  const response = await apiClient.get<PlaylistDetail>(`/playlists/${id}`, { signal })
  if (!Array.isArray(response.data?.items)) {
    throw new Error('Malformed playlist response')
  }
  return response.data
}

export async function renamePlaylist(id: number, name: string): Promise<PlaylistDetail> {
  const response = await apiClient.patch<PlaylistDetail>(`/playlists/${id}`, { name })
  return response.data
}

export async function deletePlaylist(id: number): Promise<void> {
  await apiClient.delete(`/playlists/${id}`)
}

export async function addPlaylistTrack(playlistId: number, trackId: number): Promise<PlaylistDetail> {
  const response = await apiClient.post<PlaylistDetail>(`/playlists/${playlistId}/tracks`, { track_id: trackId })
  return response.data
}

export async function removePlaylistTrack(playlistId: number, trackId: number): Promise<void> {
  await apiClient.delete(`/playlists/${playlistId}/tracks/${trackId}`)
}

export async function reorderPlaylistTracks(playlistId: number, trackIds: number[]): Promise<PlaylistDetail> {
  const response = await apiClient.put<PlaylistDetail>(`/playlists/${playlistId}/tracks/order`, { track_ids: trackIds })
  return response.data
}

export async function createShareLink(playlistId: number): Promise<PlaylistSummary> {
  const response = await apiClient.post<PlaylistSummary>(`/playlists/${playlistId}/share`)
  return response.data
}

export async function revokeShareLink(playlistId: number): Promise<void> {
  await apiClient.delete(`/playlists/${playlistId}/share`)
}

export async function fetchSharedPlaylist(token: string, signal?: AbortSignal): Promise<SharedPlaylist> {
  const response = await apiClient.get<SharedPlaylist>(`/playlists/shared/${token}`, { signal })
  if (!Array.isArray(response.data?.tracks)) {
    throw new Error('Malformed shared playlist response')
  }
  return response.data
}

export async function subscribeToSharedPlaylist(token: string): Promise<number> {
  const response = await apiClient.post<{ playlist_id: number }>(`/playlists/shared/${token}/subscribe`)
  return response.data.playlist_id
}

export async function unsubscribeFromPlaylist(playlistId: number): Promise<void> {
  await apiClient.delete(`/playlists/${playlistId}/access`)
}
