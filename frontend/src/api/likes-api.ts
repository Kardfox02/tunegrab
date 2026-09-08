import { apiClient } from './client'
import type { LikeListResponse } from '@/types/likes'

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

export async function addLike(trackId: number): Promise<void> {
  await apiClient.put(`/likes/${trackId}`)
}

export async function removeLike(trackId: number): Promise<void> {
  await apiClient.delete(`/likes/${trackId}`)
}
