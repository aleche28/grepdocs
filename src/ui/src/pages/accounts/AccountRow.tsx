import { Ellipsis, KeyRound, Unlink, UserRound } from 'lucide-react'
import { type ExternalAccount, relinkUrl } from '../../api/accounts.ts'
import { Menu } from '../../components/Menu.tsx'
import { StatusPill } from '../../components/StatusPill.tsx'
import { formatDate } from './format.ts'

interface AccountRowProps {
  account: ExternalAccount
  // From accountName().
  name: string
  // False for a provider the API no longer lists: it cannot be linked, so
  // only unlinking is offered.
  canRelink: boolean
  highlighted: boolean
  onUnlink: () => void
}

// One linked account: its name and link date, whether its access still
// works, and its actions. A re-link the account needs is a button on the
// row; otherwise it sits in the menu, with Unlink.
export function AccountRow({
  account,
  name,
  canRelink,
  highlighted,
  onUnlink,
}: AccountRowProps) {
  const linkedOn = formatDate(account.linked_at)
  const expired = account.needs_relink
  const href = relinkUrl(account.provider, account.id)

  return (
    <li className={highlighted ? 'account-row highlighted' : 'account-row'}>
      <div className="account-name">
        <span className="row-icon">
          <UserRound size={14} />
        </span>
        <div className="account-text">
          <strong>{name}</strong>
          {linkedOn && <span className="account-meta">Linked {linkedOn}</span>}
        </div>
      </div>
      <div className="account-status">
        <StatusPill tone={expired ? 'failed' : 'ok'}>
          {expired ? 'Access expired' : 'Connected'}
        </StatusPill>
      </div>
      <div className="account-actions">
        {canRelink && expired && (
          <a
            href={href}
            className="button primary"
            aria-label={`Re-link ${name}`}
          >
            Re-link
          </a>
        )}
        <Menu
          triggerClassName="icon-button"
          label={`More actions for ${name}`}
          trigger={<Ellipsis size={16} />}
        >
          {canRelink && !expired && (
            <>
              <a href={href} className="menu-item">
                <KeyRound size={15} />
                Re-link
              </a>
              <div className="menu-separator" />
            </>
          )}
          <button
            type="button"
            className="menu-item menu-danger"
            onClick={onUnlink}
          >
            <Unlink size={15} />
            Unlink
          </button>
        </Menu>
      </div>
    </li>
  )
}
