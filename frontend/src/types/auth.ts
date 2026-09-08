export interface User {
  id: number
  username: string
}

export interface AuthResponse {
  user: User
}

export interface CredentialsPayload {
  username: string
  password: string
}

export interface ChangePasswordPayload {
  current_password: string
  new_password: string
}
