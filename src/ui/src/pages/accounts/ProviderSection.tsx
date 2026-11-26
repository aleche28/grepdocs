import { Plus, UserRoundPlus } from 'lucide-react'
import { useId } from 'react'
import {
  type ExternalAccount,
  linkUrl,
  type Provider,
} from '../../api/accounts.ts'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { AccountRow } from './AccountRow.tsx'
import { accountName } from './format.ts'

interface ProviderSectionProps {
  // The provider's name as accounts carry it.
  name: string
  // Null when GET /providers does not list it (removed from the server's
  // configuration): its accounts are shown, but cannot be linked again.
  provider: Provider | null
  accounts: ExternalAccount[]
  // The account a link attempt just changed, highlighted briefly.
  highlightId: number | null
  // Opens the unlink dialog for an account, with its name.
  onUnlink: (account: ExternalAccount, name: string) => void
}

// One provider's card: its accounts, or an empty state with the link to add
// the first, and where to manage the provider's app below it.
export function ProviderSection({
  name,
  provider,
  accounts,
  highlightId,
  onUnlink,
}: ProviderSectionProps) {
  const headingId = useId()
  const displayName = provider?.display_name ?? name
  const empty = accounts.length === 0

  return (
    <section aria-labelledby={headingId} className="provider-section">
      <div className="list-card">
        <div className="list-card-header">
          <h2 id={headingId}>{displayName}</h2>
          {/* The empty state has its own. */}
          {provider && !empty && (
            <a href={linkUrl(provider.name)} className="button">
              <Plus size={15} />
              Link another {displayName} account
            </a>
          )}
          {!provider && (
            <p className="provider-note">
              No longer configured: its accounts can only be unlinked.
            </p>
          )}
        </div>

        {empty ? (
          <div className="empty-state">
            <span className="empty-icon">
              <UserRoundPlus size={20} />
            </span>
            <p>
              No {displayName} account linked yet. Link one to track your
              repositories.
            </p>
            {provider && (
              <a href={linkUrl(provider.name)} className="button primary">
                <Plus size={15} strokeWidth={2.2} />
                Link a {displayName} account
              </a>
            )}
          </div>
        ) : (
          <ul className="list-card-rows">
            {accounts.map((account) => {
              const name = accountName(account, displayName)
              return (
                <AccountRow
                  key={account.id}
                  account={account}
                  name={name}
                  canRelink={provider !== null}
                  highlighted={account.id === highlightId}
                  onUnlink={() => onUnlink(account, name)}
                />
              )
            })}
          </ul>
        )}
      </div>

      {provider?.install_url && (
        <p className="list-card-footer">
          <ExternalLink href={provider.install_url}>
            Install the {displayName} App or manage its repository access
          </ExternalLink>
        </p>
      )}
    </section>
  )
}
