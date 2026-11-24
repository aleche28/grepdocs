import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The browser only ever talks to Vite, which forwards /api to the Go API, so
// API calls are same-origin and need no CORS. The port must match the API's
// FRONTEND_URL, where it redirects after login and after linking an account.
const apiProxy = {
  '/api': 'http://localhost:3000',
}

// IPv4 loopback, not the default `localhost`: Node resolves that to ::1 first,
// so Vite would listen on IPv6 only. Browsers fall back between the two, but
// the dev container's port forwarding connects to 127.0.0.1 and would hang.
// Still loopback-only, so nothing is exposed beyond this machine.
const host = '127.0.0.1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host,
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    host,
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  // Component tests (`npm test`), run in jsdom against MSW handlers.
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
  },
})
