import { isApiObject, request } from './client'
import type {
  AdminHealth,
  CleanupOrphansResponse,
  ThumbnailsClearResponse,
  VerifyStorageResponse,
} from '@/types/admin'

export async function fetchAdminHealth(): Promise<AdminHealth> {
  return request<AdminHealth>({
    url: '/admin/health',
    assertShape: isApiObject,
    malformedMessage: 'Malformed health response',
  })
}

export async function clearThumbnails(): Promise<ThumbnailsClearResponse> {
  return request<ThumbnailsClearResponse>({
    url: '/admin/thumbnails/clear',
    method: 'post',
    assertShape: isApiObject,
    malformedMessage: 'Malformed thumbnails clear response',
  })
}

export async function runVerifyStorage(): Promise<VerifyStorageResponse> {
  return request<VerifyStorageResponse>({
    url: '/admin/commands/verify-storage',
    method: 'post',
    assertShape: isApiObject,
    malformedMessage: 'Malformed verify-storage response',
  })
}

export async function runCleanupOrphans(): Promise<CleanupOrphansResponse> {
  return request<CleanupOrphansResponse>({
    url: '/admin/commands/cleanup-orphans',
    method: 'post',
    assertShape: isApiObject,
    malformedMessage: 'Malformed cleanup-orphans response',
  })
}
