import {
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

interface DialogProps {
  title: ReactNode
  // While true (a request is running), Esc and the browser cannot close the
  // dialog: closing would not stop the request, and its outcome would go
  // unseen.
  busy: boolean
  onClose: () => void
  // Takes focus when the dialog opens, such as Cancel rather than a
  // destructive action.
  initialFocus: RefObject<HTMLElement | null>
  // Where focus goes when the dialog closes and the element that opened it
  // is gone (the row it removed) or was never focused (Safari does not focus
  // a clicked button).
  fallbackFocus: RefObject<HTMLElement | null>
  children: ReactNode
}

// A modal dialog, open for as long as it is mounted: the page renders it to
// open it and stops rendering it (onClose) to close it.
export function Dialog({
  title,
  busy,
  onClose,
  initialFocus,
  fallbackFocus,
  children,
}: DialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  // The element that opened the dialog, read on the first render, before the
  // dialog takes focus.
  const [opener] = useState(() => document.activeElement)

  useEffect(() => {
    const dialog = dialogRef.current
    // Rendered before the dialog and kept while it is open.
    const fallback = fallbackFocus.current
    dialog?.showModal()
    initialFocus.current?.focus()
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
  }, [opener, initialFocus, fallbackFocus])

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
        if (busy) {
          // Unmounting now would drop the outcome of the running request.
          dialog.showModal()
        } else {
          // Otherwise the page would keep a closed dialog mounted.
          onClose()
        }
      }}
      onCancel={(event) => {
        // Esc. The dialog closes when the page unmounts it, not on its own.
        event.preventDefault()
        if (!busy) {
          onClose()
        }
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  )
}
