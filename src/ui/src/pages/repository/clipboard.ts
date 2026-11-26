import { useEffect, useRef, useState } from 'react'

// How long "Link copied" stays on screen.
export const copiedMessageMs = 2_000

// Copies text to the clipboard and says how that went, for a role="status"
// that is always rendered (a live region announces changes, not its first
// content). The message clears after copiedMessageMs.
//
// The Clipboard API exists only in a secure context (https, or localhost):
// over plain http from another machine navigator.clipboard is undefined, and
// a browser can also refuse the write. Both say `failure`.
export function useCopyToClipboard() {
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const show = (text: string) => {
    clearTimeout(timer.current)
    setMessage(text)
    timer.current = setTimeout(() => setMessage(''), copiedMessageMs)
  }

  const copy = async (text: string, success: string, failure: string) => {
    try {
      await navigator.clipboard.writeText(text)
      show(success)
    } catch {
      show(failure)
    }
  }

  return { copy, message }
}
