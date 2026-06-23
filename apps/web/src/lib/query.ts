import { QueryClient } from '@tanstack/react-query'

/** App-wide query client. Real-time socket events will invalidate these caches. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
