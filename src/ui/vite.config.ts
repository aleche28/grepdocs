import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The browser only ever talks to Vite, which forwards /api to the Go API, so
// API calls are same-origin and need no CORS. The port must match the API's
// FRONTEND_URL, where it redirects after login and after linking an account.
const apiProxy = {
  '/api': 'http://localhost:3000',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
  preview: {
    port: 5173,
    strictPort: true,
    proxy: apiProxy,
  },
})
