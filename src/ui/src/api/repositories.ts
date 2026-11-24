import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// GET /repositories item: a repository the user tracks. Only the fields the
// UI reads so far; the repositories page (#69) adds the sync state.
export interface Repository {
  id: number
  // The linked account the repository syncs with. Null when it syncs
  // anonymously, or after that account was unlinked.
  account_id: number | null
  provider: string
  full_name: string
}

export const repositoriesQueryKey = ['repositories'] as const

export function useRepositories() {
  return useQuery({
    queryKey: repositoriesQueryKey,
    queryFn: () => apiFetch<Repository[]>('/repositories'),
  })
}
