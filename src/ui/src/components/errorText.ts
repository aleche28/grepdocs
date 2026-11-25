import { ApiError } from '../api/client.ts'

// Text and links from an ApiError that several pages show the same way.

// "Try again in 3 minutes." from a Retry-After in seconds, rounded up so the
// user never retries too early.
export function retryAfterText(seconds: number | undefined): string {
  if (seconds === undefined) {
    return 'Try again later.'
  }
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return minutes === 1
    ? 'Try again in a minute.'
    : `Try again in ${minutes} minutes.`
}

// details.install_url of an error, when the API sent one.
export function installUrlOf(error: ApiError): string | null {
  const url = error.details.install_url
  return typeof url === 'string' && url !== '' ? url : null
}
