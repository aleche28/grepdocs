import { Check, ChevronsUpDown, Lock } from 'lucide-react'
import { Link } from 'react-router'
import type { Repository } from '../../api/repositories.ts'
import { Menu } from '../../components/Menu.tsx'
import { byFullName } from '../repositories/format.ts'

interface RepositorySwitcherProps {
  current: Repository
  // Every tracked repository, the current one included.
  repositories: Repository[]
}

// The current repository's name, as a button that lists the others to go
// to, and the way back to the list of repositories.
export function RepositorySwitcher({
  current,
  repositories,
}: RepositorySwitcherProps) {
  return (
    <div className="repository-switcher">
      <Menu
        triggerClassName="switcher-button"
        // Starts with the visible name, so voice control finds the button.
        label={`${current.full_name}, switch repository`}
        trigger={
          <>
            {current.is_private && <Lock size={14} />}
            <span className="switcher-name">{current.full_name}</span>
            <ChevronsUpDown size={14} />
          </>
        }
      >
        <div className="menu-header muted">Switch repository</div>
        <div className="switcher-list">
          {byFullName(repositories).map((repository) => {
            const isCurrent = repository.id === current.id
            return (
              <Link
                key={repository.id}
                to={`/repositories/${repository.id}`}
                className="menu-item"
                aria-current={isCurrent ? 'true' : undefined}
              >
                <span className="menu-check">
                  {isCurrent && <Check size={14} strokeWidth={2.4} />}
                </span>
                <span className="switcher-name">{repository.full_name}</span>
              </Link>
            )
          })}
        </div>
        <div className="menu-separator" />
        <Link to="/repositories" className="menu-item">
          <span className="menu-check" />
          All repositories
        </Link>
      </Menu>
    </div>
  )
}
