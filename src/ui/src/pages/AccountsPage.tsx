import {
  type ExternalAccount,
  type Provider,
  useAccounts,
  useProviders,
} from '../api/accounts.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { ProviderSection } from './accounts/ProviderSection.tsx'

// /settings/accounts: the user's linked git provider accounts. Every linking
// flow ends here (see router.tsx).
export function AccountsPage() {
  const providers = useProviders()
  const accounts = useAccounts()

  let content
  if (providers.data && accounts.data) {
    content = groupByProvider(providers.data, accounts.data).map((group) => (
      <ProviderSection key={group.name} {...group} />
    ))
  } else if (providers.error || accounts.error) {
    // Only when there is nothing to show: a failed background refetch keeps
    // the lists on screen, like the auth guard keeps the current user.
    content = (
      <ApiErrorMessage
        error={providers.error ?? accounts.error}
        title="Could not load your linked accounts"
        onRetry={() => {
          if (providers.error) void providers.refetch()
          if (accounts.error) void accounts.refetch()
        }}
      />
    )
  } else {
    content = <p>Loading…</p>
  }

  return (
    <>
      <h1>Linked accounts</h1>
      {content}
    </>
  )
}

interface ProviderGroup {
  name: string
  provider: Provider | null
  accounts: ExternalAccount[]
}

// One group per provider, in GET /providers order, then one per provider the
// API no longer lists but that still has accounts, by name.
function groupByProvider(
  providers: Provider[],
  accounts: ExternalAccount[],
): ProviderGroup[] {
  const groups: ProviderGroup[] = providers.map((provider) => ({
    name: provider.name,
    provider,
    accounts: [],
  }))
  const byName = new Map(groups.map((group) => [group.name, group]))

  for (const account of accounts) {
    let group = byName.get(account.provider)
    if (!group) {
      group = { name: account.provider, provider: null, accounts: [] }
      byName.set(account.provider, group)
      groups.push(group)
    }
    group.accounts.push(account)
  }

  const listed = providers.length
  return [
    ...groups.slice(0, listed),
    ...groups.slice(listed).sort((a, b) => a.name.localeCompare(b.name)),
  ]
}
