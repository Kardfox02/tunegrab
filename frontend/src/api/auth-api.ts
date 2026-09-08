import { apiClient } from './client'
import type {
  AuthResponse,
  ChangePasswordPayload,
  CredentialsPayload,
  User,
} from '@/types/auth'

export async function getCurrentUser(): Promise<User> {
  const response = await apiClient.get<User>('/auth/me')
  return response.data
}

export async function login(credentials: CredentialsPayload): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/login', credentials)
  return response.data
}

export async function register(credentials: CredentialsPayload): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/register', credentials)
  return response.data
}

export async function logout(): Promise<void> {
  await apiClient.post('/auth/logout')
}

export async function changePassword(payload: ChangePasswordPayload): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/change-password', payload)
  return response.data
}
