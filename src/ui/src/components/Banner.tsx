import type { ReactNode } from 'react'

interface BannerProps {
  // A success is announced politely (status), an error at once (alert).
  tone: 'success' | 'error'
  children: ReactNode
  onDismiss: () => void
}

// A dismissible message about something that just happened, such as the
// outcome of linking an account. Failed API calls use ApiErrorMessage.
export function Banner({ tone, children, onDismiss }: BannerProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`banner ${tone}`}
    >
      <p>{children}</p>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
