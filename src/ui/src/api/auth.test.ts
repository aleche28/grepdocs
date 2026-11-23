import { describe, expect, test } from 'vitest'
import { googleLoginUrl, loginPath, safeRedirectPath } from './auth.ts'

describe('safeRedirectPath', () => {
  test.each([
    ['/repositories', '/repositories'],
    [
      '/repositories/3/documents/7?raw=1#intro',
      '/repositories/3/documents/7?raw=1#intro',
    ],
    // Dot segments are resolved.
    ['/settings/../repositories', '/repositories'],
  ])('keeps the same-origin path %s', (value, want) => {
    expect(safeRedirectPath(value)).toBe(want)
  })

  test.each([
    ['no value', null],
    ['an empty value', ''],
    ['a relative path', 'repositories'],
    ['an absolute URL', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example/'],
    ['a backslash read as a slash', '/\\evil.example/'],
    ['a tab the URL parser strips', '/\t/evil.example/'],
    ['a dot segment hiding a second slash', '/.//evil.example/'],
  ])('falls back to / for %s', (_, value) => {
    expect(safeRedirectPath(value)).toBe('/')
  })
})

describe('loginPath', () => {
  test('omits the redirect for the home page', () => {
    expect(loginPath('/')).toBe('/login')
  })

  test('encodes the page, with its query, as the redirect', () => {
    expect(loginPath('/settings/accounts?result=linked')).toBe(
      '/login?redirect=%2Fsettings%2Faccounts%3Fresult%3Dlinked',
    )
  })
})

describe('googleLoginUrl', () => {
  test('omits the redirect for the home page', () => {
    expect(googleLoginUrl('/')).toBe('/api/auth/google/login')
  })

  test('passes the redirect to the API', () => {
    expect(googleLoginUrl('/repositories')).toBe(
      '/api/auth/google/login?redirect=%2Frepositories',
    )
  })
})
