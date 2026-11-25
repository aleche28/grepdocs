import { type FormEvent, type RefObject, useId, useRef, useState } from 'react'
import type { ExternalAccount, Provider } from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import {
  type Repository,
  type UpdateRepositoryRequest,
  useRepositoryBranches,
  useUpdateRepository,
} from '../../api/repositories.ts'
import { Dialog } from '../../components/Dialog.tsx'
import { providerDisplayName } from './format.ts'
import { ProviderError } from './ProviderError.tsx'

interface EditDialogProps {
  repository: Repository
  provider: Provider | undefined
  account: ExternalAccount | undefined
  onClose: () => void
  // The PATCH succeeded; branchChanged says whether the branch did.
  onSaved: (repository: Repository, branchChanged: boolean) => void
  fallbackFocus: RefObject<HTMLElement | null>
}

// Changes the tracked branch and auto_sync. Mounted only while open, so the
// branches, a live provider call, are fetched only then.
export function EditDialog({
  repository,
  provider,
  account,
  onClose,
  onSaved,
  fallbackFocus,
}: EditDialogProps) {
  const branchId = useId()
  const branchRef = useRef<HTMLSelectElement>(null)
  const branches = useRepositoryBranches(repository.id)
  const update = useUpdateRepository()
  // Edited from the values the dialog opened with: a poll that changes the
  // repository meanwhile does not reset the form.
  const [branch, setBranch] = useState(repository.tracked_branch)
  const [autoSync, setAutoSync] = useState(repository.auto_sync)
  const displayName = providerDisplayName(provider, repository)
  const tracked = repository.tracked_branch

  // The tracked branch first, then the others in the provider's order. Kept
  // when the provider no longer lists it, so the select still shows it.
  const names = branches.data?.map((b) => b.name) ?? []
  const trackedMissing = branches.isSuccess && !names.includes(tracked)
  const options = [tracked, ...names.filter((name) => name !== tracked)]

  const save = (event: FormEvent) => {
    event.preventDefault()
    const changes: UpdateRepositoryRequest = {}
    if (branch !== tracked) {
      changes.tracked_branch = branch
    }
    if (autoSync !== repository.auto_sync) {
      changes.auto_sync = autoSync
    }
    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }
    update.mutate(
      { id: repository.id, changes },
      {
        onSuccess: (updated) =>
          onSaved(updated, changes.tracked_branch !== undefined),
        onError: (error) => {
          // The branch went away since the list was read.
          if (error instanceof ApiError && error.status === 400) {
            void branches.refetch()
          }
        },
      },
    )
  }

  return (
    <Dialog
      title={`Edit ${repository.full_name}`}
      busy={update.isPending}
      onClose={onClose}
      initialFocus={branchRef}
      fallbackFocus={fallbackFocus}
    >
      <form onSubmit={save} className="edit-repository">
        <div>
          <label htmlFor={branchId}>Tracked branch</label>
          <select
            id={branchId}
            ref={branchRef}
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            // While the branches load or failed, it offers the tracked one only.
            disabled={update.isPending}
          >
            {options.map((name) => (
              <option key={name} value={name}>
                {name === tracked && trackedMissing
                  ? `${name} (not found on ${displayName})`
                  : name}
              </option>
            ))}
          </select>
          {branches.isPending && <p className="muted">Loading branches…</p>}
          {branch !== tracked && (
            <p className="muted">
              Saving starts a sync of {branch}. Until it ends, the documents
              still come from {tracked}.
            </p>
          )}
        </div>
        {branches.error && (
          <ProviderError
            error={branches.error}
            title="Could not load the branches"
            repository={repository}
            provider={provider}
            account={account}
            onRetry={() => void branches.refetch()}
          />
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(event) => setAutoSync(event.target.checked)}
            disabled={update.isPending}
          />
          Sync when I open GrepDocs
        </label>
        {update.error && (
          <ProviderError
            error={update.error}
            title={`Could not save ${repository.full_name}`}
            repository={repository}
            provider={provider}
            account={account}
            branch={update.variables.changes.tracked_branch}
          />
        )}
        <div className="actions">
          <button type="submit" className="primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onClose} disabled={update.isPending}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}
