import { apiClient, request } from './client'
import type { Track, TrackListQuery, TrackListResponse } from '@/types/track'

export async function listTracks(
  query: TrackListQuery = {},
  signal?: AbortSignal,
): Promise<TrackListResponse> {
  return request<TrackListResponse>({
    url: '/tracks',
    params: { ...query },
    signal,
    assertShape: (body) => Array.isArray((body as TrackListResponse | null)?.items),
    malformedMessage: 'Malformed tracks response',
  })
}

export async function deleteTrack(trackId: number): Promise<void> {
  await apiClient.delete(`/tracks/${trackId}`)
}

export async function uploadTrack(file: File): Promise<Track> {
  const formData = new FormData()
  formData.append('file', file)
  return request<Track>({
    url: '/tracks/upload',
    method: 'post',
    data: formData,
  })
}
