import { describe, expect, test } from 'vitest'
import { ownerOf, parseOwnerAndName } from './messages.ts'

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
