import type { Track } from './track'

export interface YouTubeSearchResult {
  youtube_id: string
  title: string
  author: string
  duration: number | null
  thumbnail_url: string | null
  webpage_url: string
}

export interface YouTubeSearchResponse {
  items: YouTubeSearchResult[]
}

export interface YouTubeDownloadRequest {
  youtube_id: string
  title: string
  author: string
  duration?: number | null
  webpage_url?: string | null
  thumbnail_url?: string | null
}

export interface YouTubeDownloadResponse {
  track: Track
  queued: boolean
}

export interface ActiveDownloadsResponse {
  items: Track[]
}
