import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type {
  ExternalAccount,
  LinkOutcome,
  Provider,
} from '../../api/accounts.ts'
import { Banner } from '../../components/Banner.tsx'
import { accountName } from './format.ts'
import { ExternalLink } from '../../components/ExternalLink.tsx'

interface LinkOutcomeBannerProps {
  outcome: LinkOutcome
  providers: Provider[]
  // Undefined when the accounts could not be loaded: the message then
  // leaves out the account's name.
  accounts: ExternalAccount[] | undefined
  onDismiss: () => void
}

// The message for the redirect that ends every link attempt.
export function LinkOutcomeBanner({
  outcome,
  providers,
  accounts,
  onDismiss,
}: LinkOutcomeBannerProps) {
  const account = accounts?.find((a) => a.id === outcome.accountId)
  const provider = outcomeProvider(account, providers)
  // Generic wording when the provider is unknown (GET /providers failed, or
  // several providers and no account to tell which).
  const providerName = provider?.display_name ?? 'your git provider'
  const name =
    account && accountName(account, provider?.display_name ?? account.provider)

  return (
    <Banner
      tone={'error' in outcome ? 'error' : 'success'}
      onDismiss={onDismiss}
    >
      {message(outcome, name, providerName, provider)}
    </Banner>
  )
}

// The redirect names an account at most, never a provider. With no account,
// the only provider the server offers is the one the user linked with.
function outcomeProvider(
  account: ExternalAccount | undefined,
  providers: Provider[],
): Provider | undefined {
  if (account) {
    return providers.find((p) => p.name === account.provider)
  }
  return providers.length === 1 ? providers[0] : undefined
}

function message(
  outcome: LinkOutcome,
  name: string | undefined,
  providerName: string,
  provider: Provider | undefined,
): ReactNode {
  if ('result' in outcome) {
    if (outcome.result === 'relinked') {
      return name ? `Re-linked ${name}.` : 'Account re-linked.'
    }
    const appAccess = provider
      ? `make sure the ${provider.display_name} App can see your repositories`
      : 'make sure the app can see your repositories'
    const installUrl = provider?.install_url
    return (
      <>
        {name ? `Linked ${name}.` : 'Account linked.'} Next:{' '}
        {installUrl ? (
          <ExternalLink href={installUrl}>{appAccess}</ExternalLink>
        ) : (
          appAccess
        )}
        , then <Link to="/repositories/track">track a repository</Link>.
      </>
    )
  }

  switch (outcome.error) {
    case 'access_denied':
      return `Linking was cancelled on ${providerName}.`
    case 'invalid_state':
      return 'The linking session expired. Try again.'
    case 'link_failed':
      return `${capitalize(providerName)} did not complete the sign-in. Try again.`
    case 'identity_mismatch':
      return `You signed in to ${providerName} with a different account than ${name ?? 'the one you re-linked'}, so nothing was changed. Switch accounts in the picker and re-link again.`
    case 'account_not_found':
      return 'That account is no longer linked.'
    case 'server_error':
      return 'Something went wrong while linking. Try again.'
  }
}

// For the generic provider name at the start of a sentence.
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
