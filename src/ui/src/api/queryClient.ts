import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client.ts'

const maxRetries = 2

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx will not change on retry (a 401, a missing document, a revoked
      // GitHub token) and retrying only delays the message the user needs.
      // Network errors and 5xx may be transient, so those are retried.
      retry: (failureCount, error) => {
        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500
        ) {
          return false
        }
        return failureCount < maxRetries
      },
    },
  },
})
