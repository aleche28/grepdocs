import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from './client.ts'

// GET /repositories item: a repository the user tracks. Only the fields the
// UI reads so far; the repositories page (#69) adds the sync state.
export interface Repository {
  id: number
  // The linked account the repository syncs with. Null when it syncs
  // anonymously, or after that account was unlinked.
  account_id: number | null
  provider: string
  // With provider, what makes a tracked repository unique for a user: the
  // track page uses the pair to mark repositories already tracked.
  provider_repo_id: string
  full_name: string
  default_branch: string
  tracked_branch: string
}

export const repositoriesQueryKey = ['repositories'] as const

export function useRepositories() {
  return useQuery({
    queryKey: repositoriesQueryKey,
    queryFn: () => apiFetch<Repository[]>('/repositories'),
  })
}

// POST /repositories body. Without account_id the repository is read
// anonymously, so it must be public. The tracked branch is left out on
// purpose: the API then tracks the default branch, and changing it is the
// repositories page's job (#69).
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
      void queryClient.invalidateQueries({ queryKey: repositoriesQueryKey })
    },
    onError: (error) => {
      // Already tracked, so the list the page compares against is stale.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: repositoriesQueryKey })
      }
    },
  })
}
