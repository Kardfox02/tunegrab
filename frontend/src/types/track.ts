import type { Paginated } from './api'

export const TRACK_STATUSES = [
  'pending',
  'downloading',
  'converting',
  'finalizing',
  'done',
  'error',
  'cancelled',
] as const

export type TrackStatus = (typeof TRACK_STATUSES)[number]

export const ACTIVE_TRACK_STATUSES = [
  'pending',
  'downloading',
  'converting',
  'finalizing',
] as const satisfies readonly TrackStatus[]

export const TERMINAL_TRACK_STATUSES = ['done', 'error', 'cancelled'] as const satisfies readonly TrackStatus[]

export type TrackSortField =
  | 'created_at'
  | 'title'
  | 'author'
  | 'duration'
  | 'file_size'
  | 'progress'
  | 'status'

export type TrackSortOrder = 'asc' | 'desc'

export interface Track {
  id: number
  youtube_id: string
  title: string
  author: string
  duration: number | null
  status: TrackStatus
  progress: number
  file_size: number | null
  created_at: string
  audio_url: string | null
  cover_url: string | null
}

export interface TrackListQuery {
  q?: string
  sort_by?: TrackSortField
  order?: TrackSortOrder
  limit?: number
  offset?: number
}

export type TrackListResponse = Paginated<Track>
