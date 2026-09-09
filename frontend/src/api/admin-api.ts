import { apiClient } from './client'
import type {
  AdminHealth,
  CleanupOrphansResponse,
  ThumbnailsClearResponse,
  VerifyStorageResponse,
} from '@/types/admin'

export async function fetchAdminHealth(): Promise<AdminHealth> {
  const response = await apiClient.get<AdminHealth>('/admin/health')
  return response.data
}

export async function clearThumbnails(): Promise<ThumbnailsClearResponse> {
  const response = await apiClient.post<ThumbnailsClearResponse>('/admin/thumbnails/clear')
  return response.data
}

export async function runVerifyStorage(): Promise<VerifyStorageResponse> {
  const response = await apiClient.post<VerifyStorageResponse>('/admin/commands/verify-storage')
  return response.data
}

export async function runCleanupOrphans(): Promise<CleanupOrphansResponse> {
  const response = await apiClient.post<CleanupOrphansResponse>('/admin/commands/cleanup-orphans')
  return response.data
}
