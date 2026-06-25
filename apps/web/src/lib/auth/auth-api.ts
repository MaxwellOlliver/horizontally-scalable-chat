import axios from 'axios'
import { API_BASE_URL } from '../config'

/**
 * A bare Axios client for the `/auth/*` endpoints, deliberately WITHOUT the
 * refresh interceptor: login/refresh themselves return 401s that must surface to
 * the caller, not trigger a refresh loop.
 */
const authClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

/** `200 { accessToken, refreshToken, expiresIn }` (auth §2.6). */
export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export async function registerUser(input: {
  email: string
  password: string
  displayName: string
}): Promise<{ userId: string }> {
  const { data } = await authClient.post('/auth/register', input)
  return data as { userId: string }
}

export async function loginUser(input: { email: string; password: string }): Promise<TokenPair> {
  const { data } = await authClient.post('/auth/login', input)
  return data as TokenPair
}

export async function refreshTokens(refreshToken: string): Promise<TokenPair> {
  const { data } = await authClient.post('/auth/refresh', { refreshToken })
  return data as TokenPair
}

export async function logoutUser(refreshToken: string): Promise<void> {
  await authClient.post('/auth/logout', { refreshToken })
}
