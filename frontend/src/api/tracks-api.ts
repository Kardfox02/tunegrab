import { hasArray, hasNumber, hasString, request } from './client'
import type { Track, TrackListQuery, TrackListResponse } from '@/types/track'

// Загрузка файлаmultipart — FormData уходит без json-формы тела.
const isTrackBody = (body: unknown): boolean =>
  hasNumber(body, 'id') && hasString(body, 'status') && hasString(body, 'title')

export async function listTracks(
  query: TrackListQuery = {},
  signal?: AbortSignal,
): Promise<TrackListResponse> {
  return request<TrackListResponse>({
    url: '/tracks',
    params: { ...query },
    signal,
    assertShape: (body) => hasArray(body, 'items'),
    malformedMessage: 'Malformed tracks response',
  })
}

export async function deleteTrack(trackId: number): Promise<void> {
  await request<void>({
    url: `/tracks/${trackId}`,
    method: 'delete',
  })
}

export async function uploadTrack(file: File): Promise<Track> {
  const formData = new FormData()
  formData.append('file', file)
  return request<Track>({
    url: '/tracks/upload',
    method: 'post',
    data: formData,
    assertShape: isTrackBody,
    malformedMessage: 'Malformed upload response',
  })
}
