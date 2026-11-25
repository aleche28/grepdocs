import type { Repository } from '../../api/repositories.ts'

interface UpstreamLinkProps {
  repository: Pick<Repository, 'full_name' | 'html_url'>
  // The provider's display name, from providerDisplayName.
  displayName: string
}

// The repository on its provider, in a new tab: "GitHub ↗", named
// "acme/docs on GitHub" for screen readers.
export function UpstreamLink({ repository, displayName }: UpstreamLinkProps) {
  return (
    <a
      href={repository.html_url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${repository.full_name} on ${displayName}`}
    >
      {displayName}
      <span aria-hidden="true"> ↗</span>
    </a>
  )
}
