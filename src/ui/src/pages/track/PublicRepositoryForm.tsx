import { type FormEvent, useId, useState } from 'react'
import { type OwnerAndName, parseOwnerAndName } from './messages.ts'

interface PublicRepositoryFormProps {
  // The provider's name as the user sees it, such as "GitHub".
  providerDisplayName: string
  // True while any repository is being tracked.
  busy: boolean
  // True while the repository being tracked came from this form.
  pending: boolean
  // Tracks the repository; calls onSuccess once it is tracked.
  onTrack: (repository: OwnerAndName, onSuccess: () => void) => void
}

// Tracks a public repository by owner/name, with no linked account: the API
// reads it anonymously. A private one must come from an account's list.
export function PublicRepositoryForm({
  providerDisplayName,
  busy,
  pending,
  onTrack,
}: PublicRepositoryFormProps) {
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const repository = parseOwnerAndName(value)
    if (!repository) {
      setInvalid(true)
      return
    }
    onTrack(repository, () => setValue(''))
  }

  return (
    <form className="public-repository" noValidate onSubmit={submit}>
      <div className="field">
        <label htmlFor={inputId}>Public {providerDisplayName} repository</label>
        <div className="public-repository-control">
          <input
            id={inputId}
            type="text"
            value={value}
            placeholder="owner/name"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid}
            // The error first, so it is read before the hint.
            aria-describedby={invalid ? `${errorId} ${hintId}` : hintId}
            onChange={(event) => {
              setValue(event.target.value)
              setInvalid(false)
            }}
          />
          <button type="submit" className="primary" disabled={busy}>
            {pending ? 'Tracking…' : 'Track'}
          </button>
        </div>
        {invalid && (
          <p id={errorId} className="field-error">
            Enter the repository as owner/name.
          </p>
        )}
        <p id={hintId} className="field-hint">
          Read without an account. A private repository must come from a linked
          account's list.
        </p>
      </div>
    </form>
  )
}
