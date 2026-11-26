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
- Every page under `AppLayout` renders inside its `<main>`, capped at 70rem and padded
  (`components.css`). A route opts out with `handle: { layout: 'docs' } satisfies LayoutHandle`
  (`router.tsx`): `AppLayout` reads it with `useMatches()`, drops the cap and the padding
  (`main.docs`) and makes the header sticky, and the page lays itself out to the window's edges.
  The repository route uses it for its full-height sidebar (`RepositoryPage`), whose sticky parts
  sit below `--header-height`. Use the handle, not a class set from inside the page, so nested
  routes inherit it.
- The login page (`LoginPage`) and `RouteErrorPage` render outside `AppLayout`, so without the app
  shell: each brings its own `<main>` (`main.login` centres one card on the window).
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
  for as long as the page renders it, which keeps it open while its request runs. Actions behind a
  button (the user menu) are a `Menu` (`src/components/`): a disclosure (`aria-expanded`) of plain
  buttons and links, not an ARIA menu, so it needs no arrow keys. After an action it gives focus
  back to its button, so a `Dialog` opened from the menu returns focus there. Destructive items
  take `menu-item menu-danger` after a `menu-separator`. A link to another site is an
  `ExternalLink`, never a hand-built `target="_blank"` link (`className="menu-item"` in a menu).
- Statuses are a `StatusPill` (`src/components/`) with a tone: `ok`, `busy` (its dot pulses),
  `failed` or `pending`. A repository's tone is `syncTone()` (`src/pages/repositories/format.ts`),
  so every page colours a sync the same way. A mono fact such as a branch or a commit is a `.chip`
  (`<span className="chip">` with a lucide icon and a `<code>`). Both are styled in
  `components.css`. Put a pill that changes while the user waits in an `aria-live="polite"`
  region, but never a `RelativeTime` ("4 minutes ago", `src/pages/repositories/`): it re-renders
  every minute, and a live region would read each change out.
- A list page shows the same three states: `.empty-state` (a short explanation and the action
  that fills the list, and the page heading drops its own copy of that action), `.empty-state
  loading` (the same frame, a spinner and "Loading …") and `ApiErrorMessage`. Every page uses
  them, the not-found and error pages included (an `.empty-state` with an h1). A list is a
  `.list-card` (`components.css`): a `.list-card-header` (an h2 and its action, or a toolbar such
  as an account picker and a filter), `.list-card-rows` split by hairlines, and in place of the
  rows an `.empty-state` (the card is its frame), a `.list-card-body` around a message, or a
  `.list-card-note` line; a `.list-card-footer` line goes under the card. A row leads with a
  `.row-icon` (lock or globe, with a visually hidden "Private" / "Public"). Give a row's status
  and action columns fixed widths so the pills line up, and on a narrow screen put the name and
  actions on the first line and the rest below the name, as the repositories, accounts and track
  rows do. A filter is a `.search-field` (icon inside, a visually hidden label repeated by the
  placeholder). Row actions beyond the main one go in a `Menu` (`More actions for <name>`); an
  action the row needs now, such as re-linking an expired account, is a button on the row and
  leaves the menu. A heading with a
  count line is `.page-heading` with an h1 and a `.page-subtitle`. Dialog forms use `.dialog-lede`
  under the title, `.field` and `.field-hint` (tied to the control with `aria-describedby`), and
  `.check-field` for a checkbox with a description. Footer buttons put Cancel first and the main
  action last.
- Styles are plain CSS in `src/styles/`, imported by `main.tsx` in cascade order: `tokens.css`
  (every colour, font, size and radius, with dark values under `prefers-color-scheme`),
  `base.css` (elements and shared controls), `components.css` (the app shell and
  `src/components`), `pages.css`. Never hard-code a colour outside `tokens.css`; its text colours
  pass WCAG AA on every background, so check contrast when adding one. A plain `<button>` is the
  secondary button; `.primary`, `.danger`, `.icon-button` (with an `aria-label`) and `.link` are the
  variants, and `.button` styles a link as one. `.spin` turns an icon while something starts, and stops for
  reduced motion. Icons come from `lucide-react`, hidden from screen
  readers unless given an `aria-label`. Inter and JetBrains Mono are self-hosted through
  `@fontsource-variable`, never loaded from a font CDN.
- Formatting is Prettier (no semicolons, single quotes), linting ESLint. Run `make ui-fmt`.
- Tests are Vitest in jsdom, with Testing Library, next to the code they test (`*.test.ts(x)`).
  The API is mocked with MSW (`src/test/server.ts`), so requests go through `apiFetch` exactly as
  in the app: each test declares its endpoints with `server.use(...)`, with paths from `apiUrl()`.
  `src/test/setup.ts` fails a test that makes a request no handler matches; it also blocks the
  request, which MSW would otherwise send to the real network. It resolves relative URLs for
  Node's `fetch`, which rejects them, so `apiUrl` stays relative. Render a page with
  `renderRoute` (`src/test/renderRoute.tsx`): a memory router and a fresh `QueryClient` without
  retries, in `StrictMode` like `main.tsx`, and no `AppLayout`, so no `GET /users/me` handler is
  needed. Pass it a `queryClient` to start from a filled cache (the login test seeds a user whose
  session expired). jsdom has no modal dialogs: `setup.ts` stubs `showModal()` / `close()` and Esc, and
  queues `close` as browsers do. Vitest does not
  type-check, so a test run passes code that `make ui-typecheck` rejects (such as MSW 2's
  `onUnhandledRequest`, renamed `onUnhandledFrame` in MSW 3, which MSW then ignores).

## What the UI tests cover

UI tests (Vitest) cover the API client, the auth helpers, the app shell's loading state and user
menu (`AppLayout`), the login page (`/login`), the accounts page (`/settings/accounts`), the
track page (`/repositories/track`), the repositories page (`/repositories`), the repository page
with its document tree (`/repositories/:repoId`), the document viewer
(`/repositories/:repoId/documents/:documentId`), and the not-found and route error pages; the
setup is described above.
