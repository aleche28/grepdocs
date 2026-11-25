import { Link } from 'react-router'

// Placeholder for #69, which builds the list around the link to the track
// page (#68).
export function RepositoriesPage() {
  return (
    <>
      <h1>Repositories</h1>
      <p>
        <Link to="/repositories/track" className="button primary">
          Track a repository
        </Link>
      </p>
    </>
  )
}
