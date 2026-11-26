import type { ReactNode } from 'react'

// The pill's colour: done, in progress (its dot pulses), failed, or not
// started.
export type StatusTone = 'ok' | 'busy' | 'failed' | 'pending'

interface StatusPillProps {
  tone: StatusTone
  children: ReactNode
  // Set when the status changes on screen and the change should be read out.
  'aria-live'?: 'polite'
}

// A status in a few words, such as "Synced", on a tinted pill with a dot.
export function StatusPill({ tone, children, ...props }: StatusPillProps) {
  return (
    <span className={`status-pill ${tone}`} {...props}>
      <span className="status-dot" />
      {children}
    </span>
  )
}
