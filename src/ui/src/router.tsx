import { createBrowserRouter, Navigate } from 'react-router'
import { AccountsPage } from './pages/AccountsPage.tsx'
import { AppLayout, type LayoutHandle } from './pages/AppLayout.tsx'
import { DocumentPage } from './pages/DocumentPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { NotFoundPage } from './pages/NotFoundPage.tsx'
import { RepositoriesPage } from './pages/RepositoriesPage.tsx'
import { RepositoryPage } from './pages/RepositoryPage.tsx'
import { RouteErrorPage } from './pages/RouteErrorPage.tsx'
import { TrackRepositoryPage } from './pages/TrackRepositoryPage.tsx'

// Created once, outside the React tree, as React Router requires.
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    // Every page that needs a signed-in user lives under this layout, so the
    // auth guard (#65) and the app shell (#66) wrap them in one place.
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      // Where the API sends the user after login when no other page was
      // requested.
      { index: true, element: <Navigate to="/repositories" replace /> },
      { path: 'repositories', element: <RepositoriesPage /> },
      { path: 'repositories/track', element: <TrackRepositoryPage /> },
      {
        // The document tree stays on screen while the viewer changes.
        path: 'repositories/:repoId',
        element: <RepositoryPage />,
        // Full width, with the tree in a sidebar (AppLayout).
        handle: { layout: 'docs' } satisfies LayoutHandle,
        children: [
          { path: 'documents/:documentId', element: <DocumentPage /> },
        ],
      },
      // Fixed by the API: every linking flow ends here, with ?result= or ?error=
      // (and account_id); the codes are listed in docs/api.md → Linking and re-linking.
      { path: 'settings/accounts', element: <AccountsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
