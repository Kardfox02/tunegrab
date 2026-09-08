import { apiClient } from './client'
import type {
  ActiveDownloadsResponse,
  YouTubeDownloadRequest,
  YouTubeDownloadResponse,
  YouTubeSearchResponse,
} from '@/types/youtube'
import type { Track } from '@/types/track'

export async function searchYouTube(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<YouTubeSearchResponse> {
  const response = await apiClient.get<YouTubeSearchResponse>('/youtube/search', {
    params: { q: query, limit },
    signal,
  })
  return response.data
}

export async function queueDownload(payload: YouTubeDownloadRequest): Promise<YouTubeDownloadResponse> {
  const response = await apiClient.post<YouTubeDownloadResponse>('/youtube/download', payload)
  return response.data
}

export async function fetchDownloadStatus(trackId: number, signal?: AbortSignal): Promise<Track> {
  const response = await apiClient.get<Track>(`/youtube/${trackId}`, { signal })
  return response.data
}

export async function fetchActiveDownloads(signal?: AbortSignal): Promise<ActiveDownloadsResponse> {
  const response = await apiClient.get<ActiveDownloadsResponse>('/youtube/downloads/active', { signal })
  return response.data
}

export async function cancelDownload(trackId: number): Promise<Track> {
  const response = await apiClient.post<Track>(`/youtube/cancel/${trackId}`)
  return response.data
}

export async function retryDownload(trackId: number): Promise<Track> {
  const response = await apiClient.post<Track>(`/youtube/retry/${trackId}`)
  return response.data
}
