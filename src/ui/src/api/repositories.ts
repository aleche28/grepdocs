import {
  type QueryClient,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useRef } from 'react'
import { apiFetch, ApiError } from './client.ts'
import { documentsQueryKey } from './documents.ts'

// Where a repository is in its sync (docs/api.md → Sync status and errors).
// queued and running are busy: a sync cannot start until it ends.
export type SyncStatus = 'pending' | 'queued' | 'running' | 'ok' | 'failed'

// Why the last sync failed. They mirror the sync_error codes of the API
// (docs/api.md → Sync status and errors): add a code to both in one change.
export type SyncErrorCode =
  | 'reauth_required'
  | 'resource_not_found'
  | 'app_not_installed'
  | 'rate_limited'
  | 'truncated_tree'
  | 'provider_not_supported'
  | 'internal'

// GET /repositories item: a repository the user tracks.
export interface Repository {
  id: number
  // The linked account the repository syncs with. Null when it syncs
  // anonymously, or after that account was unlinked.
  account_id: number | null
  provider: string
  // With provider, what makes a tracked repository unique for a user: the
  // track page uses the pair to mark repositories already tracked.
  provider_repo_id: string
  owner: string
  name: string
  full_name: string
  html_url: string
  is_private: boolean
  default_branch: string
  tracked_branch: string
  synced_commit: string | null
  sync_status: SyncStatus
  // Set while the status is failed, and kept while a retry is queued.
  sync_error: SyncErrorCode | null
  // Sync when the user opens GrepDocs (useAutoSync on the repositories page).
  auto_sync: boolean
  last_sync_at: string | null
}

// GET /repositories/{id}/branches item.
export interface Branch {
  name: string
  commit: string
  protected: boolean
}

export const repositoriesQueryKey = ['repositories'] as const

export function isBusy(repository: Pick<Repository, 'sync_status'>): boolean {
  return (
    repository.sync_status === 'queued' || repository.sync_status === 'running'
  )
}

// How often the list is refetched while a sync is busy: often at first, as
// most syncs take seconds, then slowly, for a repository stuck busy until
// the server restarts (docs/sync-engine.md → When a repository stays busy).
export const fastPollMs = 2_000
export const slowPollMs = 10_000
export const fastPollPeriodMs = 60_000

// The refetch interval for a list fetched at `now`, given since when one of
// its repositories has been busy (null when none was). Returns false when
// none is busy, and the new busySince.
export function pollInterval(
  repositories: Pick<Repository, 'sync_status'>[] | undefined,
  busySince: number | null,
  now: number,
): { interval: number | false; busySince: number | null } {
  if (!repositories?.some(isBusy)) {
    return { interval: false, busySince: null }
  }
  const since = busySince ?? now
  return {
    interval: now - since < fastPollPeriodMs ? fastPollMs : slowPollMs,
    busySince: since,
  }
}

// The tracked repositories. With poll, the list is refetched while one of
// them is syncing, so its status follows the sync until it ends; TanStack
// Query pauses the refetch while the tab is hidden.
export function useRepositories({ poll = false }: { poll?: boolean } = {}) {
  // Since when a repository of the list has been busy, across refetches.
  const busySince = useRef<number | null>(null)

  return useQuery({
    queryKey: repositoriesQueryKey,
    queryFn: () => apiFetch<Repository[]>('/repositories'),
    refetchInterval: poll
      ? (query) => {
          const next = pollInterval(
            query.state.data,
            busySince.current,
            Date.now(),
          )
          busySince.current = next.busySince
          return next.interval
        }
      : false,
  })
}

// The branches of a tracked repository, read live from the provider, so
// kept for a minute and not refetched on window focus. The mutations below
// refetch the list only when it is stale, so this sits under its key.
export function repositoryBranchesQueryKey(repositoryId: number) {
  return [...repositoriesQueryKey, repositoryId, 'branches'] as const
}

export function useRepositoryBranches(repositoryId: number) {
  return useQuery({
    queryKey: repositoryBranchesQueryKey(repositoryId),
    queryFn: () => apiFetch<Branch[]>(`/repositories/${repositoryId}/branches`),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

// Puts a repository the API returned in place of its cached row. The
// response is the new row, so the list is not refetched.
function replaceRepository(queryClient: QueryClient, repository: Repository) {
  queryClient.setQueryData<Repository[]>(repositoriesQueryKey, (old) =>
    old?.map((r) => (r.id === repository.id ? repository : r)),
  )
}

function removeRepository(queryClient: QueryClient, repositoryId: number) {
  queryClient.setQueryData<Repository[]>(repositoriesQueryKey, (old) =>
    old?.filter((r) => r.id !== repositoryId),
  )
}

function refetchRepositories(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: repositoriesQueryKey })
}

// Every sync request, whoever sends it (a row, the auto-sync, the sync
// after a branch change), so a row can tell one runs for its repository.
const syncMutationKey = ['sync-repository'] as const

// POST /repositories/{id}/sync. The queued repository replaces its row,
// which starts the list's polling (useRepositories with poll). A 409
// (already busy, such as from another tab) and a 404 (untracked meanwhile)
// mean the list is stale. Callers use mutateAsync, which settles for every
// call, where mutate's own callbacks run only for the latest one.
export function useSyncRepository() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: syncMutationKey,
    mutationFn: (repositoryId: number) =>
      apiFetch<Repository>(`/repositories/${repositoryId}/sync`, {
        method: 'POST',
      }),
    onSuccess: (repository) => replaceRepository(queryClient, repository),
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 409)
      ) {
        refetchRepositories(queryClient)
      }
    },
  })
}

// Whether a sync request for the repository is in flight, from any caller.
export function useSyncStarting(repositoryId: number): boolean {
  const pending = useMutationState({
    filters: { mutationKey: syncMutationKey, status: 'pending' },
    select: (mutation) => mutation.state.variables,
  })
  return pending.includes(repositoryId)
}

// PATCH /repositories/{id} body: only the fields that change.
export interface UpdateRepositoryRequest {
  tracked_branch?: string
  auto_sync?: boolean
}

export function useUpdateRepository() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: number
      changes: UpdateRepositoryRequest
    }) =>
      apiFetch<Repository>(`/repositories/${id}`, {
        method: 'PATCH',
        json: changes,
      }),
    onSuccess: (repository) => replaceRepository(queryClient, repository),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) {
        refetchRepositories(queryClient)
      }
    },
  })
}

// DELETE /repositories/{id}, which also deletes its documents. A 404 means
// another tab untracked it already: the row and its documents leave the
// cache either way, and the caller decides what to show.
export function useUntrackRepository() {
  const queryClient = useQueryClient()

  const untracked = (repositoryId: number) => {
    removeRepository(queryClient, repositoryId)
    queryClient.removeQueries({ queryKey: documentsQueryKey(repositoryId) })
    refetchRepositories(queryClient)
  }

  return useMutation({
    mutationFn: (repositoryId: number) =>
      apiFetch<void>(`/repositories/${repositoryId}`, { method: 'DELETE' }),
    onSuccess: (_, repositoryId) => untracked(repositoryId),
    onError: (error, repositoryId) => {
      if (error instanceof ApiError && error.status === 404) {
        untracked(repositoryId)
      }
    },
  })
}

// POST /repositories body. Without account_id the repository is read
// anonymously, so it must be public. The tracked branch is left out on
// purpose: the API then tracks the default branch, and the repositories page
// changes it.
export interface TrackRepositoryRequest {
  provider: string
  owner: string
  name: string
  account_id?: number
}

export function useTrackRepository() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: TrackRepositoryRequest) =>
      apiFetch<Repository>('/repositories', { method: 'POST', json: request }),
    onSuccess: (repository) => {
      // Shown as tracked at once, before the refetch confirms it.
      queryClient.setQueryData<Repository[]>(repositoriesQueryKey, (old) =>
        old && !old.some((r) => r.id === repository.id)
          ? [...old, repository]
          : old,
      )
      refetchRepositories(queryClient)
    },
    onError: (error) => {
      // Already tracked, so the list the page compares against is stale.
      if (error instanceof ApiError && error.status === 409) {
        refetchRepositories(queryClient)
      }
    },
  })
}
