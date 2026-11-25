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
      <label htmlFor={inputId}>Public {providerDisplayName} repository</label>
      <div className="actions">
        <input
          id={inputId}
          type="text"
          value={value}
          placeholder="owner/name"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            setInvalid(false)
          }}
        />
        <button type="submit" disabled={busy}>
          {pending ? 'Tracking…' : 'Track'}
        </button>
      </div>
      {invalid && (
        <p id={errorId} className="field-error">
          Enter the repository as owner/name.
        </p>
      )}
    </form>
  )
}
