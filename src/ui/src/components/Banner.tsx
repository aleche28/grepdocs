import { CircleAlert, CircleCheck, X } from 'lucide-react'
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
  const Icon = tone === 'error' ? CircleAlert : CircleCheck
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`banner ${tone}`}
    >
      <Icon className="notice-icon" size={16} />
      <p>{children}</p>
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  )
}
