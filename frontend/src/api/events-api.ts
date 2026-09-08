import { apiClient } from './client'
import type { ListenEventPayload, ListeningStats } from '@/types/events'

export async function recordListenEvent(payload: ListenEventPayload): Promise<void> {
  await apiClient.post('/events', payload)
}

export async function fetchListeningStats(periodDays?: number): Promise<ListeningStats> {
  const response = await apiClient.get<ListeningStats>('/events/me/stats', {
    params: periodDays === undefined ? undefined : { period_days: periodDays },
  })
  return response.data
}
