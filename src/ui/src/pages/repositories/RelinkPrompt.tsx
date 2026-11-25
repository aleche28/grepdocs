import { type ExternalAccount, relinkUrl } from '../../api/accounts.ts'
import { accountName } from '../accounts/format.ts'

interface RelinkPromptProps {
  account: ExternalAccount
  // The provider's display name.
  displayName: string
}

// The provider refused the account's token: only a re-link restores access.
export function RelinkPrompt({ account, displayName }: RelinkPromptProps) {
  const name = accountName(account, displayName)
  return (
    <>
      {displayName} no longer accepts the access of {name}.{' '}
      <a href={relinkUrl(account.provider, account.id)}>Re-link {name}</a>
    </>
  )
}
