import { describe, expect, test } from 'vitest'
import { retryAfterText } from './errorText.ts'

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
