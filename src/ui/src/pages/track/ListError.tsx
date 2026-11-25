import { relinkUrl, type ExternalAccount } from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import { ApiErrorMessage } from '../../components/ApiErrorMessage.tsx'
import { installUrlOf, retryAfterText } from '../../components/errorText.ts'

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
          <div role="alert" className="error">
            <p>
              Install the {providerDisplayName} App to choose which repositories
              GrepDocs can see.
            </p>
            {installUrl && (
              <a
                href={installUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="button primary"
              >
                Install the {providerDisplayName} App
                <span aria-hidden="true"> ↗</span>
              </a>
            )}
          </div>
        )
      }
      // On this endpoint, only a token that no longer works (D6 in the PRD).
      case 'forbidden':
        return (
          <div role="alert" className="error">
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
          </div>
        )
      case 'rate_limited':
        return (
          <div role="alert" className="error">
            <p>
              {providerDisplayName}'s rate limit was reached.{' '}
              {retryAfterText(error.retryAfter)}
            </p>
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          </div>
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
