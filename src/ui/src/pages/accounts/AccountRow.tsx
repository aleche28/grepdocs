import { type ExternalAccount, relinkUrl } from '../../api/accounts.ts'
import { formatDate } from './format.ts'

interface AccountRowProps {
  account: ExternalAccount
  // From accountName().
  name: string
  // False for a provider the API no longer lists: it cannot be linked, so
  // only unlinking is offered.
  canRelink: boolean
  highlighted: boolean
}

export function AccountRow({
  account,
  name,
  canRelink,
  highlighted,
}: AccountRowProps) {
  const linkedOn = formatDate(account.linked_at)

  return (
    <li className={highlighted ? 'account-row highlighted' : 'account-row'}>
      <div className="account-identity">
        <strong>{name}</strong>
        {linkedOn && <span className="muted">Linked {linkedOn}</span>}
      </div>
      {account.needs_relink && (
        <p className="warning">Access expired. Re-link to keep syncing.</p>
      )}
      <div className="actions">
        {canRelink && (
          <a
            href={relinkUrl(account.provider, account.id)}
            className={account.needs_relink ? 'button primary' : 'button'}
            aria-label={`Re-link ${name}`}
          >
            Re-link
          </a>
        )}
      </div>
    </li>
  )
}
