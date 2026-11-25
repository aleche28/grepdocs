import { Link } from 'react-router'
import {
  type ExternalAccount,
  type Provider,
  relinkUrl,
} from '../../api/accounts.ts'
import type { Repository } from '../../api/repositories.ts'
import { accountName } from '../accounts/format.ts'

interface SyncErrorProps {
  repository: Repository
  // Undefined when GET /providers does not list it (or has not loaded).
  provider: Provider | undefined
  // The repository's account, when it has one and GET /accounts lists it.
  account: ExternalAccount | undefined
  // Opens the edit dialog, to pick another branch.
  onChangeBranch?: () => void
}

// Why the last sync failed (sync_error), and what fixes it. The codes are
// listed in docs/api.md → Sync status and errors; an unknown one reads as
// internal.
export function SyncError({
  repository,
  provider,
  account,
  onChangeBranch,
}: SyncErrorProps) {
  const displayName = provider?.display_name ?? repository.provider
  const { full_name: fullName } = repository

  switch (repository.sync_error) {
    case 'reauth_required': {
      if (account) {
        const name = accountName(account, displayName)
        return (
          <p>
            {displayName} no longer accepts the access of {name}.{' '}
            <a href={relinkUrl(account.provider, account.id)}>Re-link {name}</a>
          </p>
        )
      }
      return (
        <p>
          {displayName} no longer accepts the access of the account this
          repository syncs with.{' '}
          <Link to="/settings/accounts">Link a {displayName} account</Link>
        </p>
      )
    }
    case 'resource_not_found':
      return (
        <p>
          {displayName} can't find {fullName} or its branch{' '}
          {repository.tracked_branch} any more.
          {onChangeBranch && (
            <>
              {' '}
              <button type="button" className="link" onClick={onChangeBranch}>
                Change branch
              </button>
            </>
          )}
        </p>
      )
    case 'app_not_installed':
      return (
        <p>
          The {displayName} App isn't installed on {fullName}.
          {provider?.install_url && (
            <>
              {' '}
              <a
                href={provider.install_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Install the {displayName} App
                <span aria-hidden="true"> ↗</span>
              </a>
            </>
          )}
        </p>
      )
    case 'rate_limited':
      return (
        <p>
          {displayName}'s rate limit was reached. Try again later.
          {repository.account_id === null &&
            !repository.is_private &&
            ` Repositories tracked without an account share a low limit. Untrack it and track it again from a linked account to avoid this.`}
        </p>
      )
    case 'truncated_tree':
      return (
        <p>
          {fullName} has too many files for {displayName} to list at once. This
          isn't supported yet.
        </p>
      )
    case 'provider_not_supported':
      return <p>{displayName} isn't available on this server.</p>
    default:
      return <p>The sync failed. Try again; if it keeps failing, report it.</p>
  }
}
