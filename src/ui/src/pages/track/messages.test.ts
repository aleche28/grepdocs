import { describe, expect, test } from 'vitest'
import { ownerOf, parseOwnerAndName, retryAfterText } from './messages.ts'

describe('parseOwnerAndName', () => {
  test.each([
    ['acme/docs', { owner: 'acme', name: 'docs' }],
    ['  acme/docs  ', { owner: 'acme', name: 'docs' }],
    ['my-org/my.repo_v2-x', { owner: 'my-org', name: 'my.repo_v2-x' }],
    ['acme/.github', { owner: 'acme', name: '.github' }],
  ])('reads %j', (value, want) => {
    expect(parseOwnerAndName(value)).toEqual(want)
  })

  test.each([
    '',
    'docs',
    'acme/',
    '/docs',
    'acme/docs/extra',
    'acme docs/docs',
    'acme_org/docs',
    'acme/do cs',
    'acme/.',
    'acme/..',
    'https://github.com/acme/docs',
  ])('refuses %j', (value) => {
    expect(parseOwnerAndName(value)).toBeNull()
  })
})

describe('ownerOf', () => {
  test('is the part before the first slash', () => {
    expect(ownerOf({ full_name: 'acme/docs' })).toBe('acme')
  })
})

describe('retryAfterText', () => {
  test.each([
    [undefined, 'Try again later.'],
    [0, 'Try again in a minute.'],
    [60, 'Try again in a minute.'],
    [61, 'Try again in 2 minutes.'],
    [3600, 'Try again in 60 minutes.'],
  ])('%j seconds', (seconds, want) => {
    expect(retryAfterText(seconds)).toBe(want)
  })
})
