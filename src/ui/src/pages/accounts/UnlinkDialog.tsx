import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import { type ExternalAccount, useUnlinkAccount } from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import { type Repository, useRepositories } from '../../api/repositories.ts'
import { ApiErrorMessage } from '../../components/ApiErrorMessage.tsx'

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
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // The element that opened the dialog, read on the first render, before the
  // dialog takes focus.
  const [opener] = useState(() => document.activeElement)

  const repositories = useRepositories()
  const unlink = useUnlinkAccount()

  useEffect(() => {
    const dialog = dialogRef.current
    // Rendered before the dialog and kept while it is open.
    const fallback = fallbackFocus.current
    dialog?.showModal()
    // Cancel rather than the destructive action, which is first.
    cancelRef.current?.focus()
    return () => {
      dialog?.close()
      // Not every browser returns focus on its own.
      const returnTo =
        opener instanceof HTMLElement &&
        opener.isConnected &&
        opener !== opener.ownerDocument.body
          ? opener
          : fallback
      returnTo?.focus()
    }
  }, [opener, fallbackFocus])

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
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="dialog"
      onClose={() => {
        // The browser closed the dialog by itself, which it may do even
        // after a prevented cancel (Chrome closes on a second Esc). The event
        // is queued, so after StrictMode's simulated unmount, which closes
        // and reopens at once, it finds the dialog open and does nothing.
        const dialog = dialogRef.current
        if (!dialog || dialog.open) {
          return
        }
        if (unlink.isPending) {
          // Unmounting now would drop the outcome of the running request.
          dialog.showModal()
        } else {
          // Otherwise the page would keep a closed dialog mounted.
          onClose()
        }
      }}
      onCancel={(event) => {
        // Esc. The dialog closes when this component unmounts, not on its
        // own; and not while the request runs, since closing would not stop
        // it and the outcome would go unseen.
        event.preventDefault()
        if (!unlink.isPending) {
          onClose()
        }
      }}
    >
      <h2 id={titleId}>Unlink {name}?</h2>
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
          className="danger"
          onClick={confirm}
          disabled={unlink.isPending}
        >
          {unlink.isPending ? 'Unlinking…' : 'Unlink'}
        </button>
        <button
          type="button"
          ref={cancelRef}
          onClick={onClose}
          disabled={unlink.isPending}
        >
          Cancel
        </button>
      </div>
    </dialog>
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
    return <p className="muted">Checking tracked repositories…</p>
  }
  if (!repositories) {
    return null
  }

  const count = repositories.filter((r) => r.account_id === accountId).length
  if (count === 0) {
    return <p>No tracked repositories use this account.</p>
  }
  return (
    <p>
      {count === 1
        ? '1 tracked repository uses this account. It stays'
        : `${count} tracked repositories use this account. They stay`}{' '}
      in GrepDocs but cannot sync until you link an account that can access{' '}
      {count === 1 ? 'it' : 'them'}.
    </p>
  )
}
