export interface LikeEntry {
  track: Track
  created_at: string
}

import type { Track } from './track'

export interface LikeListResponse {
  items: LikeEntry[]
  total: number
  limit: number
  offset: number
}
