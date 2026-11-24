import { QueryClient } from '@tanstack/react-query'

// A fresh client per test, so no cached data leaks between tests.
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // The app retries network errors and 5xx (queryClient.ts); here a
      // failed request must show its error at once.
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}
