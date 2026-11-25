import { Link } from 'react-router'
import {
  type ExternalAccount,
  type Provider,
  relinkUrl,
} from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import type { Repository } from '../../api/repositories.ts'
import { ApiErrorMessage } from '../../components/ApiErrorMessage.tsx'
import { installUrlOf, retryAfterText } from '../../components/errorText.ts'
import { accountName } from '../accounts/format.ts'

interface ProviderErrorProps {
  error: Error
  // What failed, such as "Could not load the branches".
  title: string
  repository: Repository
  provider: Provider | undefined
  account: ExternalAccount | undefined
  // The branch the request asked for, named by a 400.
  branch?: string
  onRetry?: () => void
}

// A failed request that called the provider for a tracked repository (its
// branches, or a PATCH that changes the branch), as docs/api.md describes
// those failures. Anything else is an ApiErrorMessage.
export function ProviderError({
  error,
  title,
  repository,
  provider,
  account,
  branch,
  onRetry,
}: ProviderErrorProps) {
  const displayName = provider?.display_name ?? repository.provider
  const { full_name: fullName } = repository

  let message
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'forbidden':
        if (account) {
          const name = accountName(account, displayName)
          message = (
            <>
              {displayName} no longer accepts the access of {name}.{' '}
              <a href={relinkUrl(account.provider, account.id)}>
                Re-link {name}
              </a>
            </>
          )
        } else {
          message = (
            <>
              Link a {displayName} account to read this repository.{' '}
              <Link to="/settings/accounts">Go to linked accounts</Link>
            </>
          )
        }
        break
      case 'conflict':
        message = `This private repository's account was unlinked, and you have several ${displayName} accounts. Untrack it and track it again from the account to use.`
        break
      case 'not_found': {
        const installUrl = installUrlOf(error)
        message = installUrl ? (
          <>
            {displayName} can't find {fullName}, or the {displayName} App isn't
            installed on it.{' '}
            <a href={installUrl} target="_blank" rel="noopener noreferrer">
              Manage the {displayName} App's repository access
              <span aria-hidden="true"> ↗</span>
            </a>
          </>
        ) : (
          `${displayName} can't find ${fullName} any more.`
        )
        break
      }
      case 'rate_limited':
        message = `${displayName}'s rate limit was reached. ${retryAfterText(error.retryAfter)}`
        break
      case 'bad_request':
        if (branch !== undefined) {
          message = `The branch ${branch} no longer exists on ${displayName}.`
        }
        break
    }
  }

  if (!message) {
    return <ApiErrorMessage error={error} title={title} onRetry={onRetry} />
  }
  return (
    <div role="alert" className="error">
      <strong>{title}</strong>
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}
