import { useId, useState } from 'react'
import type { AccountRepository } from '../../api/accounts.ts'
import { repositoryKey } from './messages.ts'

interface RepositoryListProps {
  repositories: AccountRepository[]
  // repositoryKey() of every repository the user already tracks.
  trackedKeys: ReadonlySet<string>
  // True while any repository is being tracked: every Track button is
  // disabled until the request ends.
  busy: boolean
  // full_name of the repository being tracked from this list, if any.
  pending: string | null
  onTrack: (repository: AccountRepository) => void
}

// An account's repositories, filtered as the user types. The API returns
// the whole list at once, so the filter needs no request.
export function RepositoryList({
  repositories,
  trackedKeys,
  busy,
  pending,
  onTrack,
}: RepositoryListProps) {
  const filterId = useId()
  const [filter, setFilter] = useState('')

  const query = filter.trim().toLowerCase()
  const shown = query
    ? repositories.filter((r) => r.full_name.toLowerCase().includes(query))
    : repositories

  return (
    <>
      <p className="filter">
        <label htmlFor={filterId}>Filter repositories </label>
        <input
          id={filterId}
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </p>

      {shown.length > 0 ? (
        <ul className="repository-list">
          {shown.map((repository) => {
            const key = repositoryKey(repository)
            return (
              <li key={key} className="repository-row">
                <a
                  href={repository.html_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {repository.full_name}
                </a>
                <span className="muted">
                  {repository.is_private ? 'Private' : 'Public'}
                </span>
                <span className="muted">{repository.default_branch}</span>
                {trackedKeys.has(key) ? (
                  <span>Tracked</span>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Track ${repository.full_name}`}
                    onClick={() => onTrack(repository)}
                  >
                    {pending === repository.full_name ? 'Tracking…' : 'Track'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p>No repositories match “{filter.trim()}”.</p>
      )}
    </>
  )
}
