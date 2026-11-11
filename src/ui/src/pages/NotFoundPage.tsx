import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <>
      <h1>Page not found</h1>
      <Link to="/">Go to your repositories</Link>
    </>
  )
}
