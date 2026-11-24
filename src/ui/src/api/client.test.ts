import { http, HttpResponse } from 'msw/http'
import { describe, expect, test } from 'vitest'
import { server } from '../test/server.ts'
import { apiFetch, apiFetchText, ApiError, apiUrl } from './client.ts'

// Resolves to the ApiError a request rejects with, failing the test when it
// resolves or rejects with anything else.
async function apiErrorOf(promise: Promise<unknown>): Promise<ApiError> {
  const err: unknown = await promise.then(
    () => expect.fail('expected the request to fail'),
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ApiError)
  return err as ApiError
}

describe('apiFetch', () => {
  test('returns the JSON body, asking for JSON', async () => {
    server.use(
      http.get(apiUrl('/accounts'), ({ request }) =>
        request.headers.get('Accept') === 'application/json'
          ? HttpResponse.json([{ id: 3 }])
          : new HttpResponse(null, { status: 406 }),
      ),
    )

    await expect(apiFetch('/accounts')).resolves.toEqual([{ id: 3 }])
  })

  test('sends json as a JSON body', async () => {
    let received: { contentType: string | null; body: unknown } | undefined
    server.use(
      http.post(apiUrl('/repositories'), async ({ request }) => {
        received = {
          contentType: request.headers.get('Content-Type'),
          body: await request.json(),
        }
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )

    await apiFetch('/repositories', { method: 'POST', json: { name: 'docs' } })

    expect(received).toEqual({
      contentType: 'application/json',
      body: { name: 'docs' },
    })
  })

  test('resolves to undefined on 204', async () => {
    server.use(
      http.post(
        apiUrl('/auth/logout'),
        () => new HttpResponse(null, { status: 204 }),
      ),
    )

    await expect(
      apiFetch('/auth/logout', { method: 'POST' }),
    ).resolves.toBeUndefined()
  })

  test('turns an error envelope into an ApiError', async () => {
    server.use(
      http.get(apiUrl('/accounts/github/repositories'), () =>
        HttpResponse.json(
          {
            error: {
              code: 'rate_limited',
              message: 'Too many requests',
              details: { install_url: 'https://github.example/install' },
            },
          },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    )

    const err = await apiErrorOf(apiFetch('/accounts/github/repositories'))

    expect(err).toMatchObject({
      status: 429,
      code: 'rate_limited',
      message: 'Too many requests',
      details: { install_url: 'https://github.example/install' },
      retryAfter: 30,
    })
  })

  test('defaults details to {} when the envelope has none', async () => {
    server.use(
      http.get(apiUrl('/repositories/9'), () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'Repository not found' } },
          { status: 404 },
        ),
      ),
    )

    const err = await apiErrorOf(apiFetch('/repositories/9'))

    expect(err).toMatchObject({ status: 404, code: 'not_found', details: {} })
    expect(err.retryAfter).toBeUndefined()
  })

  test('reports a response without an envelope as unexpected_response', async () => {
    // What the Vite proxy answers while the API is down.
    server.use(
      http.get(
        apiUrl('/accounts'),
        () => new HttpResponse('Bad Gateway', { status: 502 }),
      ),
    )

    const err = await apiErrorOf(apiFetch('/accounts'))

    expect(err).toMatchObject({ status: 502, code: 'unexpected_response' })
  })

  test('reports a failed connection as network_error', async () => {
    server.use(http.get(apiUrl('/accounts'), () => HttpResponse.error()))

    const err = await apiErrorOf(apiFetch('/accounts'))

    expect(err).toMatchObject({ status: 0, code: 'network_error' })
  })
})

describe('apiFetchText', () => {
  test('returns the body as text, asking for text', async () => {
    server.use(
      http.get(apiUrl('/documents/7/raw'), ({ request }) =>
        request.headers.get('Accept') === 'text/*'
          ? HttpResponse.text('# Title')
          : new HttpResponse(null, { status: 406 }),
      ),
    )

    await expect(apiFetchText('/documents/7/raw')).resolves.toBe('# Title')
  })
})
