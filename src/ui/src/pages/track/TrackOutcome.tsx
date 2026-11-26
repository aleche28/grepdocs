import type { UseMutationResult } from '@tanstack/react-query'
import { Link } from 'react-router'
import {
  type ExternalAccount,
  type Provider,
  relinkUrl,
} from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import type {
  Repository,
  TrackRepositoryRequest,
} from '../../api/repositories.ts'
import { ApiErrorMessage } from '../../components/ApiErrorMessage.tsx'
import { Banner } from '../../components/Banner.tsx'
import { accountName } from '../accounts/format.ts'
import { installUrlOf, retryAfterText } from '../../components/errorText.ts'
import { ExternalLink } from '../../components/ExternalLink.tsx'

interface TrackOutcomeProps {
  track: UseMutationResult<Repository, Error, TrackRepositoryRequest>
  providers: Provider[]
  accounts: ExternalAccount[]
}

// The outcome of the last Track: one message at a time, replaced by the
// next attempt, and gone once dismissed (which resets the mutation).
export function TrackOutcome({
  track,
  providers,
  accounts,
}: TrackOutcomeProps) {
  const dismiss = () => track.reset()

  if (track.isSuccess) {
    return (
      <Banner tone="success" onDismiss={dismiss}>
        Tracking {track.data.full_name} on {track.data.tracked_branch}.{' '}
        <Link to="/repositories">View your repositories</Link>
      </Banner>
    )
  }
  if (!track.isError) {
    return null
  }

  const { error, variables } = track
  // What the user asked for: the API's full_name may differ (a renamed
  // repository), but there is none on failure.
  const requested = `${variables.owner}/${variables.name}`
  const displayName =
    providers.find((p) => p.name === variables.provider)?.display_name ??
    variables.provider
  const account =
    variables.account_id === undefined
      ? undefined
      : accounts.find((a) => a.id === variables.account_id)

  if (error instanceof ApiError) {
    switch (error.code) {
      case 'conflict':
        return (
          <Banner tone="error" onDismiss={dismiss}>
            {requested} is already tracked.
          </Banner>
        )
      case 'not_found': {
        const installUrl = installUrlOf(error)
        if (installUrl) {
          return (
            <Banner tone="error" onDismiss={dismiss}>
              {displayName} can't find {requested}, or the {displayName} App
              isn't installed on it.{' '}
              <ExternalLink href={installUrl}>
                Manage the {displayName} App's repository access
              </ExternalLink>
            </Banner>
          )
        }
        return (
          <Banner tone="error" onDismiss={dismiss}>
            {variables.account_id === undefined
              ? `No public repository ${requested} on ${displayName}. For a private one, link an account that can see it and pick it from the list.`
              : `${displayName} can't find ${requested}.`}
          </Banner>
        )
      }
      case 'forbidden':
        // Only a request made with an account can be refused this way.
        if (account) {
          const name = accountName(account, displayName)
          return (
            <Banner tone="error" onDismiss={dismiss}>
              {displayName} no longer accepts the access of {name}.{' '}
              <a href={relinkUrl(account.provider, account.id)}>
                Re-link {name}
              </a>
            </Banner>
          )
        }
        break
      case 'rate_limited':
        return (
          <Banner tone="error" onDismiss={dismiss}>
            {displayName}'s rate limit was reached.{' '}
            {retryAfterText(error.retryAfter)}
          </Banner>
        )
    }
  }

  return (
    <ApiErrorMessage error={error} title={`Could not track ${requested}`} />
  )
}
