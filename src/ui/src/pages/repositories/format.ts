import type { Repository } from '../../api/repositories.ts'

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

// A timestamp from the API as a date and time in the user's locale, or null
// when there is none or it does not parse (format would throw on it).
export function formatDateTime(value: string | null): string | null {
  if (value === null) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateTimeFormat.format(date)
}

// The list in a stable order, so a row does not move when its status
// changes.
export function byFullName(repositories: Repository[]): Repository[] {
  return [...repositories].sort((a, b) =>
    a.full_name.localeCompare(b.full_name),
  )
}
