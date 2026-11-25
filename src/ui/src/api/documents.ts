import { skipToken, useQuery } from '@tanstack/react-query'
import { apiFetch } from './client.ts'

// GET /documents item (docs/api.md → Documents): a Markdown file the last
// successful sync of a tracked repository stored, without its content.
export interface Document {
  id: number
  // Git blob SHA of the stored content.
  sha: string
  path: string
  synced_at: string
  repository_id: number
  // The repository's full_name, such as "acme/docs".
  repository: string
  provider: string
  // The repository's tracked branch.
  branch: string
  // The commit of the repository's last successful sync.
  upstream_commit: string | null
}

export function documentsQueryKey(repoId: number | undefined) {
  return ['documents', { repoId }] as const
}

// The documents of one tracked repository, sorted by path by the API. Not
// fetched while repoId is undefined, such as before the page knows the
// repository is the user's.
export function useDocuments(repoId: number | undefined) {
  return useQuery({
    queryKey: documentsQueryKey(repoId),
    queryFn:
      repoId === undefined
        ? skipToken
        : () => apiFetch<Document[]>(`/documents?repo_id=${repoId}`),
  })
}
