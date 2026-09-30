import { apiClient, hasArray, hasNumber, request } from './client'
import type { ListenEventPayload, ListeningStats } from '@/types/events'

export async function recordListenEvent(payload: ListenEventPayload): Promise<void> {
  await apiClient.post('/events', payload)
}

export async function fetchListeningStats(periodDays?: number): Promise<ListeningStats> {
  return request<ListeningStats>({
    url: '/events/me/stats',
    params: periodDays === undefined ? undefined : { period_days: periodDays },
    assertShape: (body) => hasNumber(body, 'play_count') && hasArray(body, 'top_tracks'),
    malformedMessage: 'Malformed listening stats response',
  })
}
