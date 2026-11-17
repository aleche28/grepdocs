import {
  hashKey,
  MutationCache,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query'
import { isNotAuthenticated, meQueryKey } from './auth.ts'
import { ApiError } from './client.ts'

const maxRetries = 2

const meQueryHash = hashKey(meQueryKey)

// A not_authenticated from any request means the session ended while the app
// was open (idle or absolute expiry, or a logout in another tab). Refetching
// the current user lets the auth guard see it and send the user to login.
// The current-user query itself is skipped: refetching it on its own 401
// would loop.
function onSessionEnded(error: unknown, queryHash?: string) {
  if (isNotAuthenticated(error) && queryHash !== meQueryHash) {
    void queryClient.invalidateQueries({ queryKey: meQueryKey })
  }
}

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => onSessionEnded(error, query.queryHash),
  }),
  mutationCache: new MutationCache({
    onError: (error) => onSessionEnded(error),
  }),
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
