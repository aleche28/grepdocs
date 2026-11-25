import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

interface MenuProps {
  // What the button shows. It is the button's accessible name unless `label`
  // is set.
  trigger: ReactNode
  // The button's accessible name, for a trigger that is only an icon.
  label?: string
  triggerClassName?: string
  // The panel: buttons and links, which close the menu when clicked.
  children: ReactNode
}

// A button that shows a panel of actions below it. It is a disclosure
// (aria-expanded), not an ARIA menu: the actions are ordinary buttons and
// links, reached with Tab, so it needs no arrow-key handling. The panel
// closes on Esc (focus goes back to the button), on a click outside, when
// focus leaves it, and after an action in it is clicked.
export function Menu({
  trigger,
  label,
  triggerClassName,
  children,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div
      ref={rootRef}
      className="menu"
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}
      onBlur={(event) => {
        // Only when focus moved somewhere else. A click on an action blurs
        // with no relatedTarget in Safari, which does not focus buttons, and
        // closing then would swallow the click.
        const next = event.relatedTarget
        if (next && !event.currentTarget.contains(next)) {
          setOpen(false)
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {trigger}
      </button>
      {open && (
        <div
          id={panelId}
          className="menu-panel"
          // Bubbles up after the action's own onClick has run.
          onClick={(event) => {
            if ((event.target as Element).closest('a, button')) {
              setOpen(false)
            }
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
