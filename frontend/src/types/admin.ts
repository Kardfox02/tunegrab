export interface StorageBreakdown {
  audio_bytes: number
  covers_bytes: number
  thumbnails_bytes: number
  total_bytes: number
}

export interface AdminHealth {
  status: string
  storage_ok: boolean
  ffmpeg_found: boolean
  track_count: number
  disk_total_bytes: number
  disk_free_bytes: number
  storage: StorageBreakdown
}

export interface ThumbnailsClearResponse {
  deleted_files: number
  freed_bytes: number
}

export interface VerifyStorageResponse {
  ok: boolean
  errors: string[]
}

export interface CleanupOrphansResponse {
  deleted_count: number
  files: string[]
}
