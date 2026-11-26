import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import {
  type ExternalAccount,
  type Provider,
  relinkUrl,
} from '../../api/accounts.ts'
import type { Repository } from '../../api/repositories.ts'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { accountName, formatDateTime } from '../accounts/format.ts'
import { providerDisplayName } from './format.ts'

interface SyncErrorProps {
  repository: Repository
  // Undefined when GET /providers does not list it (or has not loaded).
  provider: Provider | undefined
  // The repository's account, when it has one and GET /accounts lists it.
  account: ExternalAccount | undefined
  // Opens the edit dialog, to pick another branch.
  onChangeBranch: () => void
}

// A failed repository's panel: why the last sync failed (sync_error), when
// the documents it still has were synced, and the action that fixes it.
// The codes are listed in docs/api.md → Sync status and errors; an unknown
// one reads as internal. The date is absolute, not "3 days ago": the panel
// is in an aria-live region, which would read a ticking time out.
export function SyncError({
  repository,
  provider,
  account,
  onChangeBranch,
}: SyncErrorProps) {
  const { reason, fix } = explain(repository, provider, account, onChangeBranch)
  const lastSync = formatDateTime(repository.last_sync_at)

  return (
    <div className="sync-failure">
      <TriangleAlert className="notice-icon" size={16} />
      <p>
        <strong>Sync failed.</strong> <span>{reason}</span>
        {lastSync && ` Last synced ${lastSync}.`}
      </p>
      {fix && <div className="sync-failure-fix">{fix}</div>}
    </div>
  )
}

function explain(
  repository: Repository,
  provider: Provider | undefined,
  account: ExternalAccount | undefined,
  onChangeBranch: () => void,
): { reason: string; fix?: ReactNode } {
  const displayName = providerDisplayName(provider, repository)
  const { full_name: fullName } = repository

  switch (repository.sync_error) {
    case 'reauth_required': {
      // Only a re-link restores the account's access.
      if (account) {
        const name = accountName(account, displayName)
        return {
          reason: `${displayName} no longer accepts the access of ${name}.`,
          fix: (
            <a
              className="button"
              href={relinkUrl(account.provider, account.id)}
            >
              Re-link {name}
            </a>
          ),
        }
      }
      return {
        reason: `${displayName} no longer accepts the access of the account this repository syncs with.`,
        fix: (
          <Link to="/settings/accounts" className="button">
            Link a {displayName} account
          </Link>
        ),
      }
    }
    case 'resource_not_found':
      return {
        reason: `${displayName} can't find ${fullName} or its branch ${repository.tracked_branch} any more.`,
        fix: (
          <button type="button" onClick={onChangeBranch}>
            Change branch
          </button>
        ),
      }
    case 'app_not_installed':
      return {
        reason: `The ${displayName} App isn't installed on ${fullName}.`,
        fix: provider?.install_url && (
          <ExternalLink href={provider.install_url} className="button">
            Install the {displayName} App
          </ExternalLink>
        ),
      }
    case 'rate_limited':
      return {
        reason:
          `${displayName}'s rate limit was reached. Try again later.` +
          (repository.account_id === null && !repository.is_private
            ? ' Repositories tracked without an account share a low limit. Untrack it and track it again from a linked account to avoid this.'
            : ''),
      }
    case 'truncated_tree':
      return {
        reason: `${fullName} has too many files for ${displayName} to list at once. This isn't supported yet.`,
      }
    case 'provider_not_supported':
      return { reason: `${displayName} isn't available on this server.` }
    default:
      return {
        reason:
          'Something went wrong. Try again; if it keeps failing, report it.',
      }
  }
}
