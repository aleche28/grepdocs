import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { apiFetch, ApiError, apiUrl } from './client.ts'
import { repositoriesQueryKey } from './repositories.ts'

// GET /providers item: a provider accounts can be linked with.
export interface Provider {
  // Used in routes (/accounts/{name}/…) and as ExternalAccount.provider.
  name: string
  display_name: string
  // Where the user installs the provider's app or changes its repository
  // access. Null when the provider has no app or the server configures none.
  install_url: string | null
}

// GET /accounts item. The API never sends tokens.
export interface ExternalAccount {
  id: number
  provider: string
  // The stable ID at the provider, shown when provider_login is null.
  provider_user_id: string
  // The login at the provider (the GitHub username). Null for accounts
  // linked before it was recorded, until they are re-linked.
  provider_login: string | null
  // Always "" until labels can be edited (#132).
  label: string
  linked_at: string | null
  last_refreshed_at: string | null
  token_expires_at: string | null
  refresh_token_expires_at: string | null
  // The stored tokens cannot be refreshed: only a re-link restores access.
  needs_relink: boolean
}

export const providersQueryKey = ['providers'] as const
export const accountsQueryKey = ['accounts'] as const

export function useProviders() {
  return useQuery({
    queryKey: providersQueryKey,
    queryFn: () => apiFetch<Provider[]>('/providers'),
  })
}

export function useAccounts() {
  return useQuery({
    queryKey: accountsQueryKey,
    queryFn: () => apiFetch<ExternalAccount[]>('/accounts'),
  })
}

// GET /accounts/{provider}/repositories item: a repository a linked account
// can see, tracked or not.
export interface AccountRepository {
  provider: string
  // A string for every provider: Bitbucket uses UUIDs.
  provider_repo_id: string
  name: string
  full_name: string
  html_url: string
  is_private: boolean
  default_branch: string
}

// Under accountsQueryKey, so invalidating the accounts (as unlinking does)
// also drops every account's repository list.
export function accountRepositoriesQueryKey(accountId: number) {
  return [...accountsQueryKey, accountId, 'repositories'] as const
}

// The repositories of one linked account; nothing is requested while account
// is null. account_id is always sent: with several accounts for a provider,
// the API refuses to guess.
export function useAccountRepositories(
  account: Pick<ExternalAccount, 'id' | 'provider'> | null,
) {
  return useQuery({
    queryKey: accountRepositoriesQueryKey(account?.id ?? 0),
    queryFn: account
      ? () =>
          apiFetch<AccountRepository[]>(
            `/accounts/${encodeURIComponent(account.provider)}/repositories?${new URLSearchParams({ account_id: String(account.id) })}`,
          )
      : skipToken,
  })
}

// DELETE /accounts/{id}. The account leaves the cached list at once, and
// both lists are refetched: tracked repositories that used the account keep
// their rows with account_id null. The mutation settles without waiting for
// those refetches, which retry on 5xx and could hold the caller for seconds.
// A 404 means the account is already gone (another tab unlinked it): the
// accounts list is refetched so the row disappears, and the caller decides
// what to show.
export function useUnlinkAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (accountId: number) =>
      apiFetch<void>(`/accounts/${accountId}`, { method: 'DELETE' }),
    onSuccess: (_, accountId) => {
      queryClient.setQueryData<ExternalAccount[]>(accountsQueryKey, (old) =>
        old?.filter((account) => account.id !== accountId),
      )
      void queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      void queryClient.invalidateQueries({ queryKey: repositoriesQueryKey })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404) {
        void queryClient.invalidateQueries({ queryKey: accountsQueryKey })
      }
    },
  })
}

// Linking and re-linking are links, not apiFetch calls, like Google sign-in:
// the API answers with a redirect to the provider, which only a full-page
// navigation can follow. Every attempt ends back on /settings/accounts with
// the outcome in the query (parseLinkOutcome).
export function linkUrl(provider: string): string {
  return apiUrl(`/accounts/${encodeURIComponent(provider)}/login`)
}

// Re-links accountId: the API stores the result only when the provider
// returns that same identity, and reports identity_mismatch otherwise.
export function relinkUrl(provider: string, accountId: number): string {
  return `${linkUrl(provider)}?${new URLSearchParams({ account_id: String(accountId) })}`
}

// The outcome codes the API puts in the redirect after a link attempt. They
// mirror the constants in src/api/routers/account_link.go (listed in
// docs/api.md → Linking and re-linking): add a code to both in one change.
export type LinkResult = 'linked' | 'relinked'
export type LinkErrorCode =
  | 'access_denied'
  | 'invalid_state'
  | 'link_failed'
  | 'identity_mismatch'
  | 'account_not_found'
  | 'server_error'

// Records rather than arrays, so the compiler rejects a code missing from
// either the type or the list.
const linkResults: Record<LinkResult, true> = { linked: true, relinked: true }
const linkErrorCodes: Record<LinkErrorCode, true> = {
  access_denied: true,
  invalid_state: true,
  link_failed: true,
  identity_mismatch: true,
  account_not_found: true,
  server_error: true,
}

function isLinkResult(value: string): value is LinkResult {
  return Object.hasOwn(linkResults, value)
}

function isLinkErrorCode(value: string): value is LinkErrorCode {
  return Object.hasOwn(linkErrorCodes, value)
}

export type LinkOutcome =
  | { result: LinkResult; accountId: number | null }
  | { error: LinkErrorCode; accountId: number | null }

// The query parameters parseLinkOutcome reads, for the page to remove once
// it has shown the outcome.
export const linkOutcomeParams = ['result', 'error', 'account_id'] as const

// Reads the outcome of a link attempt from the redirect's query, or null when
// there is none. An error code this UI does not know becomes server_error,
// so a newer API never leaves the user without a message. An unknown result
// is ignored: claiming a success that may not be one would be worse.
export function parseLinkOutcome(params: URLSearchParams): LinkOutcome | null {
  const accountId = parseAccountId(params.get('account_id'))

  const error = params.get('error')
  if (error !== null) {
    return {
      error: isLinkErrorCode(error) ? error : 'server_error',
      accountId,
    }
  }

  const result = params.get('result')
  if (result !== null && isLinkResult(result)) {
    return { result, accountId }
  }
  return null
}

function parseAccountId(value: string | null): number | null {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) {
    return null
  }
  const id = Number(value)
  return Number.isSafeInteger(id) ? id : null
}
