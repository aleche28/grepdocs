import type { Repository } from '../../api/repositories.ts'
import { ExternalLink } from '../../components/ExternalLink.tsx'

interface UpstreamLinkProps {
  repository: Pick<Repository, 'full_name' | 'html_url'>
  // The provider's display name, from providerDisplayName.
  displayName: string
}

// The repository on its provider, in a new tab: "GitHub" and an icon, named
// "acme/docs on GitHub" for screen readers.
export function UpstreamLink({ repository, displayName }: UpstreamLinkProps) {
  return (
    <ExternalLink
      href={repository.html_url}
      aria-label={`${repository.full_name} on ${displayName}`}
    >
      {displayName}
    </ExternalLink>
  )
}
