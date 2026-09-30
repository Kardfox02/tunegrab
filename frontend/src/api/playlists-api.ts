import { hasArray, hasNumber, hasString, request } from './client'
import type { PlaylistDetail, PlaylistListResponse, PlaylistSummary, SharedPlaylist } from '@/types/playlists'

const isPlaylistSummary = (body: unknown): boolean =>
  hasNumber(body, 'id') && hasString(body, 'name')

const isPlaylistDetail = (body: unknown): boolean =>
  isPlaylistSummary(body) && hasArray(body, 'items')

export async function fetchPlaylists(signal?: AbortSignal): Promise<PlaylistListResponse> {
  return request<PlaylistListResponse>({
    url: '/playlists',
    signal,
    assertShape: (body) => hasArray(body, 'items'),
    malformedMessage: 'Malformed playlists response',
  })
}

export async function createPlaylist(name: string): Promise<PlaylistSummary> {
  return request<PlaylistSummary>({
    url: '/playlists',
    method: 'post',
    data: { name },
    assertShape: isPlaylistSummary,
    malformedMessage: 'Malformed playlist response',
  })
}

export async function fetchPlaylist(id: number, signal?: AbortSignal): Promise<PlaylistDetail> {
  return request<PlaylistDetail>({
    url: `/playlists/${id}`,
    signal,
    assertShape: isPlaylistDetail,
    malformedMessage: 'Malformed playlist response',
  })
}

export async function renamePlaylist(id: number, name: string): Promise<PlaylistDetail> {
  return request<PlaylistDetail>({
    url: `/playlists/${id}`,
    method: 'patch',
    data: { name },
    assertShape: isPlaylistDetail,
    malformedMessage: 'Malformed playlist response',
  })
}

export async function deletePlaylist(id: number): Promise<void> {
  await request<void>({
    url: `/playlists/${id}`,
    method: 'delete',
  })
}

export async function addPlaylistTrack(playlistId: number, trackId: number): Promise<PlaylistDetail> {
  return request<PlaylistDetail>({
    url: `/playlists/${playlistId}/tracks`,
    method: 'post',
    data: { track_id: trackId },
    assertShape: isPlaylistDetail,
    malformedMessage: 'Malformed playlist response',
  })
}

export async function removePlaylistTrack(playlistId: number, trackId: number): Promise<void> {
  await request<void>({
    url: `/playlists/${playlistId}/tracks/${trackId}`,
    method: 'delete',
  })
}

export async function reorderPlaylistTracks(playlistId: number, trackIds: number[]): Promise<PlaylistDetail> {
  return request<PlaylistDetail>({
    url: `/playlists/${playlistId}/tracks/order`,
    method: 'put',
    data: { track_ids: trackIds },
    assertShape: isPlaylistDetail,
    malformedMessage: 'Malformed playlist response',
  })
}

export async function createShareLink(playlistId: number): Promise<PlaylistSummary> {
  return request<PlaylistSummary>({
    url: `/playlists/${playlistId}/share`,
    method: 'post',
    assertShape: isPlaylistSummary,
    malformedMessage: 'Malformed share response',
  })
}

export async function revokeShareLink(playlistId: number): Promise<void> {
  await request<void>({
    url: `/playlists/${playlistId}/share`,
    method: 'delete',
  })
}

export async function fetchSharedPlaylist(token: string, signal?: AbortSignal): Promise<SharedPlaylist> {
  return request<SharedPlaylist>({
    url: `/playlists/shared/${token}`,
    signal,
    assertShape: (body) => hasArray(body, 'tracks'),
    malformedMessage: 'Malformed shared playlist response',
  })
}

export async function subscribeToSharedPlaylist(token: string): Promise<number> {
  const response = await request<{ playlist_id: number }>({
    url: `/playlists/shared/${token}/subscribe`,
    method: 'post',
    assertShape: (body) => hasNumber(body, 'playlist_id'),
    malformedMessage: 'Malformed subscribe response',
  })
  return response.playlist_id
}

export async function unsubscribeFromPlaylist(playlistId: number): Promise<void> {
  await request<void>({
    url: `/playlists/${playlistId}/access`,
    method: 'delete',
  })
}
