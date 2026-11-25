import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server.ts'

// Runs before every test file (vite.config.ts → test.setupFiles).

// jsdom has no modal dialogs: HTMLDialogElement has neither showModal() nor
// close(). This stands in for what the pages rely on: showModal() opens the
// dialog, Esc anywhere in the document (focus may be outside it, such as on
// a button that was just disabled) fires a cancelable "cancel" and closes
// unless it was prevented, and close() queues "close". There is no top layer
// or focus trap.
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  const escListeners = new WeakMap<
    HTMLDialogElement,
    (e: KeyboardEvent) => void
  >()

  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const cancel = new Event('cancel', { cancelable: true })
      if (this.dispatchEvent(cancel)) this.close()
    }
    escListeners.set(this, onKeyDown)
    this.ownerDocument.addEventListener('keydown', onKeyDown)
  }

  HTMLDialogElement.prototype.close = function (returnValue?: string) {
    if (!this.hasAttribute('open')) return
    this.removeAttribute('open')
    const onKeyDown = escListeners.get(this)
    if (onKeyDown) {
      this.ownerDocument.removeEventListener('keydown', onKeyDown)
      escListeners.delete(this)
    }
    if (returnValue !== undefined) this.returnValue = returnValue
    // Queued, as browsers do, not dispatched synchronously.
    setTimeout(() => this.dispatchEvent(new Event('close')))
  }
}

// jsdom does not lay out the page, so it has no scrollIntoView(). A stub,
// which a test can spy on.
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function () {}
}

let unpatchedFetch: typeof fetch

// Each request no handler matched in the current test, with MSW's message.
// Recorded synchronously, so a request made just before a test ends is still
// reported by that test's afterEach.
const unhandledRequests: { message: string }[] = []

beforeAll(() => {
  // MSW's default lets an unmatched request through to the real network
  // (such as a local API on :3000). Its 'error' strategy only fails the
  // request, which apiFetch turns into a network_error the page may render
  // without the test noticing. So this records the request, failing the test
  // in afterEach, and rejects, which fails the request instead of sending it.
  server.listen({
    onUnhandledFrame: async ({ frame }) => {
      const entry = { message: 'a request without a handler' }
      unhandledRequests.push(entry)
      entry.message = await frame.getUnhandledMessage()
      throw new Error(entry.message)
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
    const requests = unhandledRequests
      .splice(0)
      .map((entry) => entry.message)
      .join(', ')
    throw new Error(`Requests without an MSW handler: ${requests}`)
  }
})

afterAll(() => {
  globalThis.fetch = unpatchedFetch
  server.close()
})
