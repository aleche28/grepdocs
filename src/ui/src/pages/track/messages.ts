import type { AccountRepository } from '../../api/accounts.ts'
import { ApiError } from '../../api/client.ts'
import type { Repository } from '../../api/repositories.ts'

// "Try again in 3 minutes." from a Retry-After in seconds, rounded up so the
// user never retries too early.
export function retryAfterText(seconds: number | undefined): string {
  if (seconds === undefined) {
    return 'Try again later.'
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return minutes === 1
    ? 'Try again in a minute.'
    : `Try again in ${minutes} minutes.`
}

// details.install_url of an error, when the API sent one.
export function installUrlOf(error: ApiError): string | null {
  const url = error.details.install_url
  return typeof url === 'string' && url !== '' ? url : null
}

// What identifies a repository across the tracked list and an account's
// list: the API's uniqueness key for a user.
export function repositoryKey(
  repository: Pick<
    Repository | AccountRepository,
    'provider' | 'provider_repo_id'
  >,
): string {
  return `${repository.provider}:${repository.provider_repo_id}`
}

// The owner from a full_name such as "acme/docs". Discovered repositories
// carry name and full_name, but POST /repositories wants owner and name.
export function ownerOf(
  repository: Pick<AccountRepository, 'full_name'>,
): string {
  const slash = repository.full_name.indexOf('/')
  return slash === -1
    ? repository.full_name
    : repository.full_name.slice(0, slash)
}
