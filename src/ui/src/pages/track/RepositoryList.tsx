import { GitBranch, Globe, Lock, Plus, Search } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import type { AccountRepository } from '../../api/accounts.ts'
import { ExternalLink } from '../../components/ExternalLink.tsx'
import { StatusPill } from '../../components/StatusPill.tsx'
import { repositoryKey } from './messages.ts'

interface RepositoryListProps {
  // The account picker, shown in the card's header beside the filter.
  picker: ReactNode
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
  picker,
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
    <div className="list-card">
      <div className="list-card-header">
        {picker}
        <div className="search-field track-filter">
          <label htmlFor={filterId} className="visually-hidden">
            Filter repositories
          </label>
          <Search size={14} />
          <input
            id={filterId}
            type="search"
            placeholder="Filter repositories"
            autoComplete="off"
            spellCheck={false}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </div>
      </div>

      {shown.length > 0 ? (
        <ul className="list-card-rows">
          {shown.map((repository) => {
            const key = repositoryKey(repository)
            const { full_name: fullName } = repository
            return (
              <li key={key} className="track-row">
                <div className="track-name">
                  <span className="row-icon">
                    {repository.is_private ? (
                      <Lock size={14} />
                    ) : (
                      <Globe size={14} />
                    )}
                    <span className="visually-hidden">
                      {repository.is_private ? 'Private' : 'Public'}
                    </span>
                  </span>
                  <ExternalLink href={repository.html_url}>
                    {fullName}
                  </ExternalLink>
                </div>
                <div className="track-branch">
                  <span className="chip" title={repository.default_branch}>
                    <GitBranch size={12} />
                    <span className="visually-hidden">Default branch </span>
                    <code>{repository.default_branch}</code>
                  </span>
                </div>
                <div className="track-action">
                  {trackedKeys.has(key) ? (
                    <StatusPill tone="ok">Tracked</StatusPill>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={`Track ${fullName}`}
                      onClick={() => onTrack(repository)}
                    >
                      {pending === fullName ? (
                        'Tracking…'
                      ) : (
                        <>
                          <Plus size={14} />
                          Track
                        </>
                      )}
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="list-card-note">
          No repositories match “{filter.trim()}”.
        </p>
      )}
    </div>
  )
}
