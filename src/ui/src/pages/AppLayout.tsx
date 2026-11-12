import { Outlet } from 'react-router'

// Placeholder: the auth guard (#65) and the navigation shell (#66) go here.
export function AppLayout() {
  return (
    <main>
      <Outlet />
    </main>
  )
}
