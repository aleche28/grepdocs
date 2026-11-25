import type { ExternalAccount } from '../../api/accounts.ts'

// How the page names an account: its login, or its provider ID for accounts
// linked before the login was recorded (they get one on their next re-link).
export function accountName(
  account: ExternalAccount,
  providerDisplayName: string,
): string {
  if (account.provider_login) {
    return `@${account.provider_login}`
  }
  return `${providerDisplayName} account ${account.provider_user_id}`
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

// A timestamp from the API in the user's locale, or null when there is none
// or it does not parse (format would throw on it).
function formatTimestamp(
  value: string | null,
  format: Intl.DateTimeFormat,
): string | null {
  if (value === null) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : format.format(date)
}

// "Mar 2, 2026"
export function formatDate(value: string | null): string | null {
  return formatTimestamp(value, dateFormat)
}

// "Mar 2, 2026, 10:11 AM"
export function formatDateTime(value: string | null): string | null {
  return formatTimestamp(value, dateTimeFormat)
}
