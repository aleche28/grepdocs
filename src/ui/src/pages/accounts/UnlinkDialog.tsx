import { type RefObject, useRef } from 'react'
import { type ExternalAccount, useUnlinkAccount } from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import { type Repository, useRepositories } from '../../api/repositories.ts'
import { ApiErrorMessage } from '../../components/ApiErrorMessage.tsx'
import { Dialog } from '../../components/Dialog.tsx'

interface UnlinkDialogProps {
  account: ExternalAccount
  // From accountName().
  name: string
  onClose: () => void
  onUnlinked: () => void
  // Where focus goes when the dialog closes and the element that opened it
  // is gone (the unlinked account's row) or was never focused (Safari does
  // not focus a clicked button).
  fallbackFocus: RefObject<HTMLElement | null>
}

// Confirms unlinking an account, with the tracked repositories it affects.
// Mounted only while open, so the repositories are fetched only then.
export function UnlinkDialog({
  account,
  name,
  onClose,
  onUnlinked,
  fallbackFocus,
}: UnlinkDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  const repositories = useRepositories()
  const unlink = useUnlinkAccount()

  const confirm = () =>
    unlink.mutate(account.id, {
      onSuccess: onUnlinked,
      onError: (error) => {
        // Already gone: the hook refetches the accounts, and there is
        // nothing left to confirm.
        if (error instanceof ApiError && error.status === 404) {
          onClose()
        }
      },
    })

  return (
    <Dialog
      title={`Unlink ${name}?`}
      busy={unlink.isPending}
      onClose={onClose}
      // Cancel rather than the destructive action.
      initialFocus={cancelRef}
      fallbackFocus={fallbackFocus}
    >
      <ImpactLine
        accountId={account.id}
        repositories={repositories.data}
        isPending={repositories.isPending}
      />
      {unlink.error && (
        <ApiErrorMessage
          error={unlink.error}
          title="Could not unlink the account"
        />
      )}
      <div className="actions">
        <button
          type="button"
          ref={cancelRef}
          onClick={onClose}
          disabled={unlink.isPending}
        >
          Cancel
        </button>
        <button
          type="button"
          className="danger"
          onClick={confirm}
          disabled={unlink.isPending}
        >
          {unlink.isPending ? 'Unlinking…' : 'Unlink'}
        </button>
      </div>
    </Dialog>
  )
}

interface ImpactLineProps {
  accountId: number
  repositories: Repository[] | undefined
  isPending: boolean
}

// How many tracked repositories lose their account. Nothing when the count
// failed to load: it never blocks unlinking.
function ImpactLine({ accountId, repositories, isPending }: ImpactLineProps) {
  if (isPending) {
    return <p className="dialog-lede">Checking tracked repositories…</p>
  }
  if (!repositories) {
    return null
  }

  const count = repositories.filter((r) => r.account_id === accountId).length
  if (count === 0) {
    return (
      <p className="dialog-lede">No tracked repositories use this account.</p>
    )
  }
  return (
    <p className="dialog-lede">
      {count === 1
        ? '1 tracked repository uses this account. It stays'
        : `${count} tracked repositories use this account. They stay`}{' '}
      in GrepDocs but cannot sync until you link an account that can access{' '}
      {count === 1 ? 'it' : 'them'}.
    </p>
  )
}
