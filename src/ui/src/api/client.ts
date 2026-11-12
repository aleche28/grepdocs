// Stable codes from the API's error envelope (httpx.Code* in the Go API).
export type ApiErrorCode =
  | 'not_authenticated'
  | 'bad_request'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'not_implemented'
  | 'internal'
  | 'rate_limited'
  | 'app_not_installed'
  | 'service_unavailable'

// Client-side codes for failures that never produced an API envelope:
// the server could not be reached, or something else (such as the dev
// proxy with the API down) answered instead of the API.
export type ClientErrorCode = 'network_error' | 'unexpected_response'

export class ApiError extends Error {
  // 0 when no response arrived.
  readonly status: number
  readonly code: ApiErrorCode | ClientErrorCode
  // Extra data for some errors, such as install_url on app_not_installed.
  readonly details: Record<string, unknown>
  // Seconds from the Retry-After header, when the API sent one.
  readonly retryAfter?: number

  constructor(
    status: number,
    code: ApiErrorCode | ClientErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    retryAfter?: number,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  // Sent as a JSON body, with the matching Content-Type.
  json?: unknown
}

// Fetches a JSON endpoint under /api. Resolves to undefined on 204.
export async function apiFetch<T>(
  path: string,
  init: ApiRequestInit = {},
): Promise<T> {
  const res = await request(path, init, 'application/json')
  if (res.status === 204) {
    return undefined as T
  }
  return (await res.json()) as T
}

// Fetches an endpoint under /api that returns text, such as a document's
// raw Markdown.
export async function apiFetchText(
  path: string,
  init: ApiRequestInit = {},
): Promise<string> {
  const res = await request(path, init, 'text/*')
  return res.text()
}

async function request(
  path: string,
  { json, headers, ...init }: ApiRequestInit,
  accept: string,
): Promise<Response> {
  const reqHeaders = new Headers(headers)
  reqHeaders.set('Accept', accept)
  if (json !== undefined) {
    reqHeaders.set('Content-Type', 'application/json')
  }

  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: reqHeaders,
      body: json === undefined ? undefined : JSON.stringify(json),
    })
  } catch (err) {
    // An aborted request (TanStack Query cancelling a query) is not a
    // failure to report.
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw err
    }
    throw new ApiError(0, 'network_error', 'Could not reach the server.')
  }

  if (!res.ok) {
    throw await toApiError(res)
  }
  return res
}

async function toApiError(res: Response): Promise<ApiError> {
  const retryAfter = parseRetryAfter(res.headers.get('Retry-After'))
  const body: unknown = await res.json().catch(() => undefined)

  if (isErrorEnvelope(body)) {
    const { code, message, details } = body.error
    return new ApiError(res.status, code, message, details ?? {}, retryAfter)
  }
  return new ApiError(
    res.status,
    'unexpected_response',
    `Unexpected response from the server (HTTP ${res.status}).`,
    {},
    retryAfter,
  )
}

interface ErrorEnvelope {
  error: {
    code: ApiErrorCode
    message: string
    details?: Record<string, unknown>
  }
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return false
  }
  const { error } = body
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

// The API only sends Retry-After in seconds, never as an HTTP date.
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) {
    return undefined
  }
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}
