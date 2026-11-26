import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Repository } from '../../api/repositories.ts'

interface ContentHeaderProps {
  // The repository the page is in; unset when the page found none.
  repository?: Pick<Repository, 'id' | 'full_name'>
  // The document's path, which ends the trail as the page's heading.
  path?: string
  // The heading when there is no path, such as "Document not found".
  // Without either, the repository's name is the heading.
  title?: string
  // The page's actions, at the right.
  actions?: ReactNode
  // A line of facts below, such as the branch and the commit.
  meta?: ReactNode
}

// The top of the content column: a trail of where the page is (Repositories
// / owner/repo / directories / file), whose last part is the page's <h1>,
// with the page's actions beside it. The trail's links are a breadcrumb
// <nav>; the heading follows it, so it is both the end of the trail and the
// page's title.
export function ContentHeader({
  repository,
  path,
  title,
  actions,
  meta,
}: ContentHeaderProps) {
  const heading = path ?? title ?? repository?.full_name
  const linkRepository = repository && heading !== repository.full_name

  return (
    <div className="content-header">
      <div className="trail">
        <nav aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to="/repositories">Repositories</Link>
            </li>
            {linkRepository && (
              <li>
                <Separator />
                <Link to={`/repositories/${repository.id}`}>
                  {repository.full_name}
                </Link>
              </li>
            )}
          </ol>
        </nav>
        <Separator />
        <h1>{path ? <PathHeading path={path} /> : heading}</h1>
      </div>
      {actions && <div className="content-actions">{actions}</div>}
      {meta}
    </div>
  )
}

// A path's directories, muted, then its file name. The slashes are text,
// so the heading's accessible name is the path as written.
function PathHeading({ path }: { path: string }) {
  const segments = path.split('/')
  const name = segments.pop()
  return (
    <>
      {segments.map((segment, i) => (
        <Fragment key={i}>
          <span className="trail-directory">{segment}</span>
          <span className="trail-separator">/</span>
        </Fragment>
      ))}
      <span className="trail-current">{name}</span>
    </>
  )
}

function Separator() {
  return (
    <span className="trail-separator" aria-hidden="true">
      /
    </span>
  )
}
