import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw/http'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { createTestQueryClient } from '../test/queryClient.ts'
import { server } from '../test/server.ts'
import {
  type AccountRepository,
  accountRepositoriesQueryKey,
  accountsQueryKey,
  linkUrl,
  parseLinkOutcome,
  relinkUrl,
  useAccountRepositories,
  useUnlinkAccount,
} from './accounts.ts'
import { apiUrl } from './client.ts'
import { repositoriesQueryKey } from './repositories.ts'

describe('linkUrl and relinkUrl', () => {
  test('link starts the flow without a target', () => {
    expect(linkUrl('github')).toBe('/api/accounts/github/login')
  })

  test('re-link names the target account', () => {
    expect(relinkUrl('github', 3)).toBe(
      '/api/accounts/github/login?account_id=3',
    )
  })

  test('the provider name is escaped', () => {
    expect(linkUrl('a/b')).toBe('/api/accounts/a%2Fb/login')
  })
})

describe('parseLinkOutcome', () => {
  const parse = (query: string) => parseLinkOutcome(new URLSearchParams(query))

  test.each([
    ['result=linked&account_id=3', { result: 'linked', accountId: 3 }],
    ['result=relinked&account_id=3', { result: 'relinked', accountId: 3 }],
    ['error=access_denied', { error: 'access_denied', accountId: null }],
    ['error=invalid_state', { error: 'invalid_state', accountId: null }],
    ['error=link_failed', { error: 'link_failed', accountId: null }],
    [
      'error=identity_mismatch&account_id=3',
      { error: 'identity_mismatch', accountId: 3 },
    ],
    [
      'error=account_not_found',
      { error: 'account_not_found', accountId: null },
    ],
    ['error=server_error', { error: 'server_error', accountId: null }],
  ])('reads %s', (query, want) => {
    expect(parse(query)).toEqual(want)
  })

  test('an unknown error code becomes server_error', () => {
    expect(parse('error=something_new')).toEqual({
      error: 'server_error',
      accountId: null,
    })
  })

  test('an empty error is still an error', () => {
    expect(parse('error=')).toEqual({ error: 'server_error', accountId: null })
  })

  test('an error wins over a result', () => {
    expect(parse('result=linked&error=link_failed')).toEqual({
      error: 'link_failed',
      accountId: null,
    })
  })

  test.each([
    ['no outcome', ''],
    ['an account_id alone', 'account_id=3'],
    ['an unknown result', 'result=maybe&account_id=3'],
  ])('returns null for %s', (_, query) => {
    expect(parse(query)).toBeNull()
  })

  test.each(['0', '-3', '3.5', '03', 'abc', '', '99999999999999999999'])(
    'ignores the account_id %j',
    (value) => {
      expect(parse(`result=linked&account_id=${value}`)).toEqual({
        result: 'linked',
        accountId: null,
      })
    },
  )
})

describe('useUnlinkAccount', () => {
  // Seeds both lists, so the test can see which ones the mutation
  // invalidates.
  function renderUnlink() {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(accountsQueryKey, [])
    queryClient.setQueryData(repositoriesQueryKey, [])
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useUnlinkAccount(), { wrapper })
    const isInvalidated = (queryKey: readonly string[]) =>
      queryClient.getQueryState(queryKey)?.isInvalidated
    return { result, isInvalidated }
  }

  test('refetches accounts and repositories after unlinking', async () => {
    server.use(
      http.delete(apiUrl('/accounts/3'), () =>
        HttpResponse.json({
          message: 'External account unlinked successfully',
        }),
      ),
    )
    const { result, isInvalidated } = renderUnlink()

    result.current.mutate(3)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(isInvalidated(accountsQueryKey)).toBe(true)
    expect(isInvalidated(repositoriesQueryKey)).toBe(true)
  })

  test('refetches accounts when the account is already gone', async () => {
    server.use(
      http.delete(apiUrl('/accounts/3'), () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'Account not found' } },
          { status: 404 },
        ),
      ),
    )
    const { result, isInvalidated } = renderUnlink()

    result.current.mutate(3)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated(accountsQueryKey)).toBe(true)
    expect(isInvalidated(repositoriesQueryKey)).toBe(false)
  })

  test('refetches nothing on any other error', async () => {
    server.use(
      http.delete(apiUrl('/accounts/3'), () =>
        HttpResponse.json(
          { error: { code: 'internal', message: 'Something went wrong' } },
          { status: 500 },
        ),
      ),
    )
    const { result, isInvalidated } = renderUnlink()

    result.current.mutate(3)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(isInvalidated(accountsQueryKey)).toBe(false)
    expect(isInvalidated(repositoriesQueryKey)).toBe(false)
  })
})

describe('useAccountRepositories', () => {
  const discovered: AccountRepository[] = [
    {
      provider: 'github',
      provider_repo_id: '1001',
      name: 'docs',
      full_name: 'acme/docs',
      html_url: 'https://github.com/acme/docs',
      is_private: false,
      default_branch: 'main',
    },
  ]

  function renderAccountRepositories(
    account: { id: number; provider: string } | null,
  ) {
    const queryClient = createTestQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useAccountRepositories(account), {
      wrapper,
    })
    return { result, queryClient }
  }

  test("requests the account's repositories by its id", async () => {
    const requested: string[] = []
    server.use(
      http.get(apiUrl('/accounts/github/repositories'), ({ request }) => {
        requested.push(new URL(request.url).search)
        return HttpResponse.json(discovered)
      }),
    )
    const { result } = renderAccountRepositories({ id: 3, provider: 'github' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(discovered)
    expect(requested).toEqual(['?account_id=3'])
  })

  test('requests nothing without an account', () => {
    // setup.ts fails the test on any request, since no handler is declared.
    const { result } = renderAccountRepositories(null)

    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  test('invalidating the accounts also invalidates the list', async () => {
    server.use(
      http.get(apiUrl('/accounts/github/repositories'), () =>
        HttpResponse.json(discovered),
      ),
    )
    const { result, queryClient } = renderAccountRepositories({
      id: 3,
      provider: 'github',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Without refetching, so the state stays invalidated for the assertion.
    void queryClient.invalidateQueries(
      { queryKey: accountsQueryKey },
      { cancelRefetch: false },
    )

    expect(
      queryClient.getQueryState(accountRepositoriesQueryKey(3))?.isInvalidated,
    ).toBe(true)
  })
})
