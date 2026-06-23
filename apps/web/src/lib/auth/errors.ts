import { AxiosError } from 'axios'

/**
 * Maps an auth request failure to a single, human message — generic on bad
 * credentials so we don't leak which field was wrong (auth AC-L2).
 */
export function authErrorMessage(err: unknown, mode: 'login' | 'register'): string {
  if (err instanceof AxiosError) {
    if (!err.response) {
      return 'Can’t reach the server. Make sure the API is running.'
    }
    const status = err.response.status
    const body = err.response.data as { message?: string } | undefined
    if (mode === 'login' && status === 401) return 'Email or password is incorrect.'
    if (status === 409) return 'That email is already registered.'
    if (status === 422) return body?.message ?? 'Check your details and try again.'
  }
  return 'Something went wrong. Please try again.'
}
