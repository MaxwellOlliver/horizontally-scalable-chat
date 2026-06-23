import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { API_BASE_URL } from './config'
import { tokenStore } from './auth/token-store'
import { refreshAccessToken } from './auth/refresh'

/**
 * The shared API client for `/social/*` and `/chat/*` (and any other protected
 * REST). It attaches the access token on every request and transparently
 * refreshes a single time on a 401 — rotating the token pair (auth §2.2) and
 * replaying the original request. A failed refresh clears the session, which
 * trips the router's auth guard back to the login screen.
 */
export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const session = tokenStore.getSnapshot()
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`
  }
  return config
})

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined
    if (!original || error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }
    if (!tokenStore.getSnapshot()?.refreshToken) {
      return Promise.reject(error)
    }

    original._retry = true
    try {
      const accessToken = await refreshAccessToken()
      original.headers.Authorization = `Bearer ${accessToken}`
      return api(original)
    } catch (refreshError) {
      tokenStore.clear() // refresh token expired/revoked/reused — force re-login
      return Promise.reject(refreshError)
    }
  },
)
