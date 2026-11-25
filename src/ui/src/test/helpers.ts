import { screen, within } from '@testing-library/react'
import { HttpResponse } from 'msw/http'

// Helpers shared by the page and hook tests.

// An API error envelope, as httpx.WriteError(WithDetails) sends it.
export function errorResponse(
  status: number,
  code: string,
  message: string = `${code} message`,
  { details, headers }: { details?: object; headers?: HeadersInit } = {},
) {
  return HttpResponse.json(
    { error: details ? { code, message, details } : { code, message } },
    { status, headers },
  )
}

// A response the test releases when it is ready, to look at the page while
// the request is still in flight.
export function gate() {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  return { released, release }
}

// The list item holding the link named `name` (a repository's full_name),
// to query inside one row.
export async function findRow(name: string) {
  const link = await screen.findByRole('link', { name })
  return within(link.closest('li')!)
}
