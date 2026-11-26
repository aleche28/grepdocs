import { ExternalLink as ExternalLinkIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface ExternalLinkProps {
  href: string
  children: ReactNode
  // Names the target when the text alone does not, such as "GitHub".
  'aria-label'?: string
  // Such as "button primary", for a link that is the page's main action.
  className?: string
}

// A link to another site, in a new tab, marked with an icon (hidden from
// screen readers).
export function ExternalLink({ href, children, ...props }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
      <ExternalLinkIcon className="external-icon" size="0.9em" />
    </a>
  )
}
