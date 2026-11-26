import { FileQuestion } from 'lucide-react'
import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <FileQuestion size={20} />
      </span>
      <h1>Page not found</h1>
      <p>
        There is nothing at this address. The link may be wrong, or the page may
        have moved.
      </p>
      <Link to="/" className="button">
        Go to your repositories
      </Link>
    </div>
  )
}
