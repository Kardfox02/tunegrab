import { apiClient } from './client'
import type { LikedTrackIdsResponse, LikeListResponse } from '@/types/likes'

export interface LikesQuery {
  limit?: number
  offset?: number
}

export async function fetchLikes(query: LikesQuery = {}, signal?: AbortSignal): Promise<LikeListResponse> {
  const response = await apiClient.get<LikeListResponse>('/likes', {
    params: { ...query },
    signal,
  })
  return response.data
}

export async function fetchLikedTrackIds(signal?: AbortSignal): Promise<number[]> {
  const response = await apiClient.get<LikedTrackIdsResponse>('/likes/ids', { signal })
  const trackIds = response.data?.track_ids
  if (!Array.isArray(trackIds)) {
    throw new Error('Malformed liked track ids response')
  }
  return trackIds
}

export async function addLike(trackId: number): Promise<void> {
  await apiClient.put(`/likes/${trackId}`)
}

export async function removeLike(trackId: number): Promise<void> {
  await apiClient.delete(`/likes/${trackId}`)
}
