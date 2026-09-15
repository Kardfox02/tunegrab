import { apiClient, request } from './client'
import type {
  AuthResponse,
  ChangePasswordPayload,
  CredentialsPayload,
  User,
} from '@/types/auth'

export async function getCurrentUser(): Promise<User> {
  return request<User>({ url: '/auth/me' })
}

export async function login(credentials: CredentialsPayload): Promise<AuthResponse> {
  return request<AuthResponse>({ url: '/auth/login', method: 'post', data: credentials })
}

export async function register(credentials: CredentialsPayload): Promise<AuthResponse> {
  return request<AuthResponse>({ url: '/auth/register', method: 'post', data: credentials })
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout')
}

export async function changePassword(payload: ChangePasswordPayload): Promise<AuthResponse> {
  return request<AuthResponse>({ url: '/auth/change-password', method: 'post', data: payload })
}
