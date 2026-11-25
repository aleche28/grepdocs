import { describe, expect, test } from 'vitest'
import { prefixFragment, providerFileUrl, resolveLink } from './links.ts'

const from = 'docs/guides/faq.md'

describe('resolveLink', () => {
  test.each([
    ['setup.md', 'docs/guides/setup.md'],
    ['./setup.md', 'docs/guides/setup.md'],
    ['../api/index.md', 'docs/api/index.md'],
    ['../../README.md', 'README.md'],
    ['/README.md', 'README.md'],
    ['/docs//api/./index.md', 'docs/api/index.md'],
    ['my%20doc.md', 'docs/guides/my doc.md'],
    ['../', 'docs'],
  ])('resolves %s against the document', (href, path) => {
    expect(resolveLink(from, href)).toEqual({
      kind: 'path',
      path,
      query: '',
      fragment: '',
    })
  })

  test('resolves against the root for a document at the root', () => {
    expect(resolveLink('README.md', 'docs/setup.md')).toMatchObject({
      path: 'docs/setup.md',
    })
  })

  test('keeps the query and the fragment of a path, as written', () => {
    expect(resolveLink(from, 'setup.md?plain=1#step-2')).toEqual({
      kind: 'path',
      path: 'docs/guides/setup.md',
      query: 'plain=1',
      fragment: 'step-2',
    })
  })

  test('points a query alone at the document itself', () => {
    expect(resolveLink(from, '?plain=1')).toEqual({
      kind: 'path',
      path: from,
      query: 'plain=1',
      fragment: '',
    })
  })

  test('prefixes a fragment alone', () => {
    expect(resolveLink(from, '#install')).toEqual({
      kind: 'fragment',
      fragment: 'user-content-install',
    })
  })

  test.each([
    ['above the root', '../../../outside.md'],
    ['above the root from the root', '/../README.md'],
    ['not decodable', 'bad%zz.md'],
  ])('rejects a path %s', (_, href) => {
    expect(resolveLink(from, href)).toEqual({ kind: 'invalid' })
  })

  test.each([
    ['https://example.com/a.md', 'https://example.com/a.md'],
    ['mailto:docs@example.com', 'mailto:docs@example.com'],
    ['//example.com/a.png', 'https://example.com/a.png'],
  ])('leaves an absolute URL alone: %s', (href, expected) => {
    expect(resolveLink(from, href)).toEqual({
      kind: 'external',
      href: expected,
    })
  })
})

describe('prefixFragment', () => {
  test.each([
    ['install', 'user-content-install'],
    ['user-content-install', 'user-content-install'],
    ['', ''],
  ])('%s → %s', (fragment, expected) => {
    expect(prefixFragment(fragment)).toBe(expected)
  })
})

describe('providerFileUrl', () => {
  const github = {
    provider: 'github',
    html_url: 'https://github.com/acme/docs',
  }

  test('builds GitHub file URLs, each segment encoded', () => {
    expect(providerFileUrl(github, 'abcd123', 'docs/my doc#1.md', 'blob')).toBe(
      'https://github.com/acme/docs/blob/abcd123/docs/my%20doc%231.md',
    )
    expect(providerFileUrl(github, 'feature/x', 'img/a.png', 'raw')).toBe(
      'https://github.com/acme/docs/raw/feature/x/img/a.png',
    )
  })

  test('knows no URLs for another provider', () => {
    expect(
      providerFileUrl(
        { provider: 'bitbucket', html_url: 'https://bitbucket.org/acme/docs' },
        'abcd123',
        'README.md',
        'blob',
      ),
    ).toBeNull()
  })
})
