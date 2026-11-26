import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { relinkUrl, type ExternalAccount } from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import { ApiErrorMessage } from '../../components/ApiErrorMessage.tsx'
import { installUrlOf, retryAfterText } from '../../components/errorText.ts'
import { ExternalLink } from '../../components/ExternalLink.tsx'

interface ListErrorProps {
  error: Error
  account: ExternalAccount
  // From accountName().
  accountName: string
  providerDisplayName: string
  onRetry: () => void
}

// Why an account's repositories could not be listed, with the action that
// fixes it when there is one.
export function ListError({
  error,
  account,
  accountName,
  providerDisplayName,
  onRetry,
}: ListErrorProps) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'app_not_installed': {
        const installUrl = installUrlOf(error)
        return (
          <Failure>
            <p>
              Install the {providerDisplayName} App to choose which repositories
              GrepDocs can see.
            </p>
            {installUrl && (
              <ExternalLink href={installUrl} className="button primary">
                Install the {providerDisplayName} App
              </ExternalLink>
            )}
          </Failure>
        )
      }
      // On this endpoint, only a token that no longer works (D6 in the PRD).
      case 'forbidden':
        return (
          <Failure>
            <p>
              {providerDisplayName} no longer accepts the access of{' '}
              {accountName}.
            </p>
            <a
              href={relinkUrl(account.provider, account.id)}
              className="button primary"
            >
              Re-link {accountName}
            </a>
          </Failure>
        )
      case 'rate_limited':
        return (
          <Failure>
            <p>
              {providerDisplayName}'s rate limit was reached.{' '}
              {retryAfterText(error.retryAfter)}
            </p>
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </Failure>
        )
    }
  }

  return (
    <ApiErrorMessage
      error={error}
      title={`Could not list the repositories of ${accountName}`}
      onRetry={onRetry}
    />
  )
}

// The frame of ApiErrorMessage, for a message with its own action.
function Failure({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="error">
      <CircleAlert className="notice-icon" size={16} />
      <div className="notice-body">{children}</div>
    </div>
  )
}
