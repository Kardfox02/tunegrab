export const LISTEN_EVENT_TYPES = ['play', 'skip', 'complete'] as const

export type ListenEventType = (typeof LISTEN_EVENT_TYPES)[number]

export interface ListenEventPayload {
  track_id: number
  event_type: ListenEventType
  fraction_played: number
}

export interface TopTrackEntry {
  track: Track
  play_count: number
  listened_seconds: number
}

import type { Track } from './track'

export interface ListeningStats {
  period_days: number
  play_count: number
  skip_count: number
  complete_count: number
  listened_seconds: number
  top_tracks: TopTrackEntry[]
}

export interface ListeningHistoryItem {
  event: {
    id: number
    track_id: number
    event_type: ListenEventType
    fraction_played: number
    created_at: string
  }
  track: Track
}

export interface ListeningHistoryResponse {
  items: ListeningHistoryItem[]
  total: number
  limit: number
  offset: number
}
