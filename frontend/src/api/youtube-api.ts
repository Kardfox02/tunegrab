import { hasArray, hasNumber, hasString, isApiObject, request } from './client'
import type {
  ActiveDownloadsResponse,
  YouTubeDownloadRequest,
  YouTubeDownloadResponse,
  YouTubeSearchResponse,
} from '@/types/youtube'
import type { Track } from '@/types/track'

// Soft validation: мусорный ответ — понятная ошибка, а не NaN-progress
// глубоко в поллере.
const isTrackBody = (body: unknown): boolean =>
  hasNumber(body, 'id') && hasString(body, 'status') && hasString(body, 'title')

const isDownloadResponse = (body: unknown): boolean =>
  isApiObject(body) && isTrackBody(body.track) && typeof body.queued === 'boolean'

export async function searchYouTube(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<YouTubeSearchResponse> {
  return request<YouTubeSearchResponse>({
    url: '/youtube/search',
    params: { q: query, limit },
    signal,
    assertShape: (body) => hasArray(body, 'items'),
    malformedMessage: 'Malformed search response',
  })
}

export async function queueDownload(payload: YouTubeDownloadRequest): Promise<YouTubeDownloadResponse> {
  return request<YouTubeDownloadResponse>({
    url: '/youtube/download',
    method: 'post',
    data: payload,
    assertShape: isDownloadResponse,
    malformedMessage: 'Malformed download response',
  })
}

export async function fetchDownloadStatus(trackId: number, signal?: AbortSignal): Promise<Track> {
  return request<Track>({
    url: `/youtube/${trackId}`,
    signal,
    assertShape: isTrackBody,
    malformedMessage: 'Malformed track status response',
  })
}

export async function fetchActiveDownloads(signal?: AbortSignal): Promise<ActiveDownloadsResponse> {
  return request<ActiveDownloadsResponse>({
    url: '/youtube/downloads/active',
    signal,
    assertShape: (body) => hasArray(body, 'items'),
    malformedMessage: 'Malformed active downloads response',
  })
}

export async function cancelDownload(trackId: number): Promise<Track> {
  return request<Track>({
    url: `/youtube/cancel/${trackId}`,
    method: 'post',
    assertShape: isTrackBody,
    malformedMessage: 'Malformed cancel response',
  })
}

export async function retryDownload(trackId: number): Promise<Track> {
  return request<Track>({
    url: `/youtube/retry/${trackId}`,
    method: 'post',
    assertShape: isTrackBody,
    malformedMessage: 'Malformed retry response',
  })
}
