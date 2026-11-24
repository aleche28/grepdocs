import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  type ExternalAccount,
  linkOutcomeParams,
  parseLinkOutcome,
  type Provider,
  useAccounts,
  useProviders,
} from '../api/accounts.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { LinkOutcomeBanner } from './accounts/LinkOutcomeBanner.tsx'
import { ProviderSection } from './accounts/ProviderSection.tsx'

// /settings/accounts: the user's linked git provider accounts. Every linking
// flow ends here (see router.tsx), with its outcome in the query.
export function AccountsPage() {
  const providers = useProviders()
  const accounts = useAccounts()

  // Read once, on mount: the API's redirect is a full page load, so the page
  // never receives an outcome while it is already open. State rather than a
  // value derived from the URL, which the effect below clears.
  const [searchParams, setSearchParams] = useSearchParams()
  const [outcome, setOutcome] = useState(() => parseLinkOutcome(searchParams))

  // Remove the outcome from the URL, so a refresh or a back navigation does
  // not show it again.
  useEffect(() => {
    if (!linkOutcomeParams.some((param) => searchParams.has(param))) {
      return
    }
    const rest = new URLSearchParams(searchParams)
    for (const param of linkOutcomeParams) {
      rest.delete(param)
    }
    setSearchParams(rest, { replace: true })
  }, [searchParams, setSearchParams])

  let content
  if (providers.data && accounts.data) {
    // Only a success points at the row it changed.
    const highlightId =
      outcome && 'result' in outcome ? outcome.accountId : null
    content = groupByProvider(providers.data, accounts.data).map((group) => (
      <ProviderSection key={group.name} highlightId={highlightId} {...group} />
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
      {/* Held until both lists have settled, so the message does not change
          when the account it names arrives. */}
      {outcome && !providers.isPending && !accounts.isPending && (
        <LinkOutcomeBanner
          outcome={outcome}
          providers={providers.data ?? []}
          accounts={accounts.data}
          onDismiss={() => setOutcome(null)}
        />
      )}
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
