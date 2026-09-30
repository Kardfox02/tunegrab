import { hasArray, request } from './client'
import type { LikedTrackIdsResponse, LikeListResponse } from '@/types/likes'

export interface LikesQuery {
  limit?: number
  offset?: number
}

export async function fetchLikes(query: LikesQuery = {}, signal?: AbortSignal): Promise<LikeListResponse> {
  return request<LikeListResponse>({
    url: '/likes',
    params: { ...query },
    signal,
    assertShape: (body) => hasArray(body, 'items'),
    malformedMessage: 'Malformed likes response',
  })
}

export async function fetchLikedTrackIds(signal?: AbortSignal): Promise<number[]> {
  const response = await request<LikedTrackIdsResponse>({
    url: '/likes/ids',
    signal,
    assertShape: (body) => hasArray(body, 'track_ids'),
    malformedMessage: 'Malformed liked track ids response',
  })
  return response.track_ids
}

export async function addLike(trackId: number): Promise<void> {
  await request<void>({
    url: `/likes/${trackId}`,
    method: 'put',
  })
}

export async function removeLike(trackId: number): Promise<void> {
  await request<void>({
    url: `/likes/${trackId}`,
    method: 'delete',
  })
}
