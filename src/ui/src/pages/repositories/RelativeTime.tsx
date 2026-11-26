import { useEffect, useState } from 'react'
import { formatDateTime } from '../accounts/format.ts'
import { relativeTime } from './format.ts'

// The current time, refreshed every `intervalMs`, so a relative time stays
// right while the page is open.
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

// A timestamp from the API as "4 minutes ago", with the date and time on
// hover. Renders nothing when the timestamp does not parse. Keep it out of
// aria-live regions: its text changes every minute.
export function RelativeTime({ value }: { value: string }) {
  const now = useNow(60_000)
  const text = relativeTime(value, now)
  if (text === null) {
    return null
  }
  return (
    <time dateTime={value} title={formatDateTime(value) ?? undefined}>
      {text}
    </time>
  )
}
