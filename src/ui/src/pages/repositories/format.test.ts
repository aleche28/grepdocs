import { describe, expect, test } from 'vitest'
import { relativeTime } from './format.ts'

describe('relativeTime', () => {
  const now = Date.parse('2026-11-26T12:00:00Z')
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString()

  test.each<[string, string | null, string | null]>([
    ['a few seconds ago', ago(30), 'just now'],
    ['a time ahead of this clock', ago(-90), 'just now'],
    ['one minute', ago(60), '1 minute ago'],
    ['minutes, rounded down', ago(4 * 60 + 59), '4 minutes ago'],
    ['hours', ago(2 * 3600), '2 hours ago'],
    ['one day', ago(86_400), 'yesterday'],
    ['days', ago(3 * 86_400), '3 days ago'],
    ['months', ago(65 * 86_400), '2 months ago'],
    ['years', ago(800 * 86_400), '2 years ago'],
    ['no timestamp', null, null],
    ['one that does not parse', 'not a date', null],
  ])('says %s', (_, value, text) => {
    expect(relativeTime(value, now)).toBe(text)
  })
})
