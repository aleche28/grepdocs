import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server.ts'

// Runs before every test file (vite.config.ts → test.setupFiles).

let unpatchedFetch: typeof fetch

// MSW's message for each request no handler matched in the current test.
const unhandledRequests: string[] = []

beforeAll(() => {
  // MSW's default lets an unmatched request through to the real network
  // (such as a local API on :3000). Its 'error' strategy only fails the
  // request, which apiFetch turns into a network_error the page may render
  // without the test noticing. So this records the request, failing the test
  // in afterEach, and rejects, which fails the request instead of sending it.
  server.listen({
    onUnhandledFrame: async ({ frame }) => {
      const message = await frame.getUnhandledMessage()
      unhandledRequests.push(message)
      throw new Error(message)
    },
  })

  // apiFetch requests relative URLs ("/api/accounts"), which a browser
  // resolves against the page. Node's fetch has no page and rejects them, so
  // resolve them against jsdom's location here instead of changing the app.
  // Installed after listen(), so it wraps the fetch MSW intercepts.
  unpatchedFetch = globalThis.fetch
  globalThis.fetch = (input, init) =>
    unpatchedFetch(
      typeof input === 'string' ? new URL(input, window.location.href) : input,
      init,
    )
})

afterEach(() => {
  // Testing Library only unmounts on its own when the test runner has
  // globals, which this setup does not enable.
  cleanup()
  server.resetHandlers()

  if (unhandledRequests.length > 0) {
    const requests = unhandledRequests.splice(0).join(', ')
    throw new Error(`Requests without an MSW handler: ${requests}`)
  }
})

afterAll(() => {
  globalThis.fetch = unpatchedFetch
  server.close()
})
