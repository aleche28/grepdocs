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

// A timestamp from the API as a date in the user's locale, or null when
// there is none or it does not parse (format would throw on it).
export function formatDate(value: string | null): string | null {
  if (value === null) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date)
}
