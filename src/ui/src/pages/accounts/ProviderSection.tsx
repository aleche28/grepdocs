import { useId } from 'react'
import {
  type ExternalAccount,
  linkUrl,
  type Provider,
} from '../../api/accounts.ts'
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

export function ProviderSection({
  name,
  provider,
  accounts,
  highlightId,
  onUnlink,
}: ProviderSectionProps) {
  const headingId = useId()
  const displayName = provider?.display_name ?? name

  return (
    <section aria-labelledby={headingId} className="provider-section">
      <h2 id={headingId}>{displayName}</h2>

      {accounts.length > 0 ? (
        <ul className="account-list">
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
      ) : (
        <p>
          No {displayName} account linked yet. Link one to track your
          repositories.
        </p>
      )}

      {provider && (
        <div className="actions">
          <a href={linkUrl(provider.name)} className="button">
            {accounts.length > 0
              ? `Link another ${displayName} account`
              : `Link a ${displayName} account`}
          </a>
          {provider.install_url && (
            <a
              href={provider.install_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Install the {displayName} App or manage its repository access
              <span aria-hidden="true"> ↗</span>
            </a>
          )}
        </div>
      )}
    </section>
  )
}
