import { apiClient } from './client'
import type { Track, TrackListQuery, TrackListResponse } from '@/types/track'

export async function listTracks(
  query: TrackListQuery = {},
  signal?: AbortSignal,
): Promise<TrackListResponse> {
  const response = await apiClient.get<TrackListResponse>('/tracks', {
    params: { ...query },
    signal,
  })
  return response.data
}

export async function deleteTrack(trackId: number): Promise<void> {
  await apiClient.delete(`/tracks/${trackId}`)
}

export async function uploadTrack(file: File): Promise<Track> {
  const formData = new FormData()
  formData.append('file', file)
  const response = await apiClient.post<Track>('/tracks/upload', formData)
  return response.data
}
