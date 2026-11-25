import { type RefObject, useRef } from 'react'
import type { Provider } from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import {
  type Repository,
  useUntrackRepository,
} from '../../api/repositories.ts'
import { ApiErrorMessage } from '../../components/ApiErrorMessage.tsx'
import { Dialog } from '../../components/Dialog.tsx'

interface UntrackDialogProps {
  repository: Repository
  provider: Provider | undefined
  onClose: () => void
  // Also called on a 404: another tab untracked it already.
  onUntracked: () => void
  fallbackFocus: RefObject<HTMLElement | null>
}

// Confirms untracking a repository, which deletes its synced documents.
export function UntrackDialog({
  repository,
  provider,
  onClose,
  onUntracked,
  fallbackFocus,
}: UntrackDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const untrack = useUntrackRepository()
  const displayName = provider?.display_name ?? repository.provider

  const confirm = () =>
    untrack.mutate(repository.id, {
      onSuccess: onUntracked,
      onError: (error) => {
        if (error instanceof ApiError && error.status === 404) {
          onUntracked()
        }
      },
    })

  return (
    <Dialog
      title={`Stop tracking ${repository.full_name}?`}
      busy={untrack.isPending}
      onClose={onClose}
      // Cancel rather than the destructive action, which is first.
      initialFocus={cancelRef}
      fallbackFocus={fallbackFocus}
    >
      <p>
        Its synced documents are removed from GrepDocs. Nothing changes on{' '}
        {displayName}.
      </p>
      {untrack.error && (
        <ApiErrorMessage
          error={untrack.error}
          title={`Could not untrack ${repository.full_name}`}
        />
      )}
      <div className="actions">
        <button
          type="button"
          className="danger"
          onClick={confirm}
          disabled={untrack.isPending}
        >
          {untrack.isPending ? 'Untracking…' : 'Untrack'}
        </button>
        <button
          type="button"
          ref={cancelRef}
          onClick={onClose}
          disabled={untrack.isPending}
        >
          Cancel
        </button>
      </div>
    </Dialog>
  )
}
