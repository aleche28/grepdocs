import { useOutletContext } from 'react-router'
import type { Document } from '../../api/documents.ts'
import type { Repository } from '../../api/repositories.ts'

// What RepositoryPage hands to the page in its outlet. It renders the outlet
// only once it has found the repository, so a nested page never handles a
// missing one.
export interface RepositoryContext {
  repository: Repository
  // The repository's documents; undefined while they load or when they
  // failed.
  documents: Document[] | undefined
}

export function useRepositoryContext(): RepositoryContext {
  return useOutletContext<RepositoryContext>()
}
