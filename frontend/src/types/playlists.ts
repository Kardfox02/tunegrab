import type { Track } from './track'

export interface PlaylistSummary {
  id: number
  name: string
  track_count: number
  created_at: string
  owner_username: string
  is_owner: boolean
  share_url: string | null
}

export interface PlaylistDetail {
  id: number
  name: string
  created_at: string
  owner_username: string
  is_owner: boolean
  share_url: string | null
  items: Track[]
}

export interface PlaylistListResponse {
  items: PlaylistSummary[]
  total: number
}

export interface SharedPlaylist {
  name: string
  owner_username: string
  tracks: Track[]
}
