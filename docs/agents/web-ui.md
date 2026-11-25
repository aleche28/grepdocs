# Web UI

Moved from `AGENTS.md`. Read it before changing anything in `src/ui`.

React + TypeScript, built with Vite, React Router for routes, TanStack Query for data from the API.

- Locally, the browser only talks to the Vite dev server on `:5173`, which proxies `/api` to the API
  on `:3000` (`vite.config.ts`), so API calls are same-origin and need no CORS. The API redirects to
  `FRONTEND_URL` (default `http://localhost:5173`) after login and after linking an account, so the
  dev server uses `strictPort`. The OAuth callbacks stay on `:3000`: browsers do not separate
  cookies by port, so the cookie set there reaches `:5173`.
- Every API call goes through `apiFetch` / `apiFetchText` (`src/api/client.ts`), never `fetch`
  directly, the same way every API response goes through `httpx`. Paths omit the `/api` prefix.
  Non-2xx responses become an `ApiError` with the envelope's `code`, `message`, `details`, and
  `retryAfter`; `network_error` (status 0) and `unexpected_response` (no envelope, such as the
  proxy's `502` with the API down) are client-only codes.
- Data from the API lives in TanStack Query, through the shared `queryClient`
  (`src/api/queryClient.ts`), not in component state. Queries retry on network errors and 5xx,
  never on 4xx.
- Routes are in `src/router.tsx`, one component per route in `src/pages/`. Pages that need a
  signed-in user sit under the `AppLayout` route. `/settings/accounts` is fixed by the API, which
  redirects there after linking an account.
- Auth (`src/api/auth.ts`): `AppLayout` is the guard. It renders nothing until the shared
  `useCurrentUser()` query (`GET /users/me`) resolves, and sends a `not_authenticated` user to
  `/login?redirect=<path>`; any other error shows a retry, never the login page. Any query or
  mutation that fails with `not_authenticated` refetches that query (`queryClient.ts`), so a
  session that expires mid-use also ends on the login page. Signing in is a plain link to
  `apiUrl('/auth/google/login')`, the one deliberate exception to `apiFetch`: only a full-page
  navigation can follow the redirect to Google. Logout calls `queryClient.clear()` so the next user
  in the tab sees none of the previous one's data. A redirect path read from the URL goes through
  `safeRedirectPath` before any client-side navigation.
- `AppLayout` is also the app shell (navigation, current user, sign out). Pages show a failed API
  call with `ApiErrorMessage` (`src/components/`), never by hand: it shows the envelope's message,
  offers a retry, and renders nothing for `not_authenticated`, which the guard handles. Errors that
  need a page-specific action (`app_not_installed`'s `install_url`, `rate_limited`'s
  `retryAfter`) are handled by that page. A dismissible message about something that just
  happened (a link attempt, an unlink) is a `Banner` (`src/components/`): a status for a success,
  an alert for a failure. A confirmation or a small form is a `Dialog` (`src/components/`), open
  for as long as the page renders it, which keeps it open while its request runs.
- Formatting is Prettier (no semicolons, single quotes), linting ESLint. Run `make ui-fmt`.
- Tests are Vitest in jsdom, with Testing Library, next to the code they test (`*.test.ts(x)`).
  The API is mocked with MSW (`src/test/server.ts`), so requests go through `apiFetch` exactly as
  in the app: each test declares its endpoints with `server.use(...)`, with paths from `apiUrl()`.
  `src/test/setup.ts` fails a test that makes a request no handler matches; it also blocks the
  request, which MSW would otherwise send to the real network. It resolves relative URLs for
  Node's `fetch`, which rejects them, so `apiUrl` stays relative. Render a page with
  `renderRoute` (`src/test/renderRoute.tsx`): a memory router and a fresh `QueryClient` without
  retries, in `StrictMode` like `main.tsx`, and no `AppLayout`, so no `GET /users/me` handler is
  needed. jsdom has no modal dialogs: `setup.ts` stubs `showModal()` / `close()` and Esc, and
  queues `close` as browsers do. Vitest does not
  type-check, so a test run passes code that `make ui-typecheck` rejects (such as MSW 2's
  `onUnhandledRequest`, renamed `onUnhandledFrame` in MSW 3, which MSW then ignores).

## What the UI tests cover

UI tests (Vitest) cover the API client, the auth helpers, the accounts page (`/settings/accounts`), the track page
(`/repositories/track`), the repositories page (`/repositories`), the repository page with
its document tree (`/repositories/:repoId`), and the document viewer
(`/repositories/:repoId/documents/:documentId`); the setup is described above.
