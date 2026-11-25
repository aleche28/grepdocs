import type { ReactNode } from 'react'
import { ApiError } from '../api/client.ts'
import { isNotAuthenticated } from '../api/auth.ts'

interface ApiErrorMessageProps {
  error: unknown
  // What failed, shown before the message, such as "Could not sign out".
  title?: string
  // Replaces the envelope's message, for a page that says what to do about
  // this error (such as a re-link link).
  message?: ReactNode
  // Shows a "Try again" button that calls it.
  onRetry?: () => void
}

// The one way pages show a failed API call. Envelope messages are written for
// users (internal errors arrive as a generic message), and the client-only
// codes carry their own, so the message is shown as is. Errors that need a
// page-specific action, such as app_not_installed, are handled by that page.
export function ApiErrorMessage({
  error,
  title,
  message,
  onRetry,
}: ApiErrorMessageProps) {
  // queryClient.ts refetches the current user and the auth guard sends the
  // user to the login page; showing the error would only flash before that.
  if (isNotAuthenticated(error)) {
    return null
  }

  const text =
    message ??
    (error instanceof ApiError ? error.message : 'Something went wrong.')

  return (
    <div role="alert" className="error">
      {title && <strong>{title}</strong>}
      <p>{text}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
