import type { ReactNode } from 'react'

interface ExternalLinkProps {
  href: string
  children: ReactNode
  // Names the target when the text alone does not, such as "GitHub".
  'aria-label'?: string
}

// A link to another site, in a new tab, marked with ↗ (hidden from screen
// readers).
export function ExternalLink({ href, children, ...props }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  )
}
