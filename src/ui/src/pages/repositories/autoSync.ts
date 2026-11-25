import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { ApiError } from '../../api/client.ts'
import {
  type Repository,
  repositoriesQueryKey,
  replaceRepository,
  syncRepository,
} from '../../api/repositories.ts'

// Whether opening the app should sync a repository: auto_sync is on and it
// is idle, and a new sync can succeed. Failures that need the user (re-link,
// install the app, another branch) are not retried on their own.
export function syncsOnOpen(repository: Repository): boolean {
  if (!repository.auto_sync) {
    return false
  }
  switch (repository.sync_status) {
    case 'pending':
    case 'ok':
      return true
    case 'failed':
      return (
        repository.sync_error === null ||
        repository.sync_error === 'rate_limited' ||
        repository.sync_error === 'internal'
      )
    default:
      return false
  }
}

// The clients that already ran the auto-sync. A full page load (opening the
// app) creates a new client; moving between pages, and StrictMode's double
// effects, keep it. Tests get a fresh client each, so each starts clean.
const done = new WeakSet<QueryClient>()

// Syncs the auto_sync repositories once per page load, as soon as the list
// first arrives (S8.4). A 202 replaces the row, which starts the list's
// polling; a 409 means the repository is busy already. Calls onQueueFull with
// the number of repositories the full queue refused (503); other failures
// change nothing on screen.
export function useAutoSync(
  repositories: Repository[] | undefined,
  onQueueFull: (count: number) => void,
) {
  const queryClient = useQueryClient()
  // The latest callback, without restarting the effect when it changes.
  const onQueueFullRef = useRef(onQueueFull)
  useEffect(() => {
    onQueueFullRef.current = onQueueFull
  })

  useEffect(() => {
    if (!repositories || done.has(queryClient)) {
      return
    }
    done.add(queryClient)

    const due = repositories.filter(syncsOnOpen)
    if (due.length === 0) {
      return
    }
    void Promise.allSettled(
      due.map(async (repository) => {
        const queued = await syncRepository(repository.id)
        replaceRepository(queryClient, queued)
      }),
    ).then((results) => {
      const queueFull = results.filter(
        (result) =>
          result.status === 'rejected' &&
          result.reason instanceof ApiError &&
          result.reason.status === 503,
      ).length
      if (queueFull > 0) {
        onQueueFullRef.current(queueFull)
      }
      // Whatever happened, the list may be stale: a 409 or a 404 says so.
      void queryClient.invalidateQueries({ queryKey: repositoriesQueryKey })
    })
  }, [repositories, queryClient])
}
