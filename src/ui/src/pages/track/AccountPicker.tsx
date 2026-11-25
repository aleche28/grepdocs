import { useId } from 'react'
import type { ExternalAccount } from '../../api/accounts.ts'

export interface AccountOption {
  account: ExternalAccount
  // From accountName(), with the provider when there are several.
  label: string
}

interface AccountPickerProps {
  options: AccountOption[]
  selectedId: number | null
  onSelect: (accountId: number) => void
}

// The account to list repositories from. With one account there is nothing
// to choose, so it is only named.
export function AccountPicker({
  options,
  selectedId,
  onSelect,
}: AccountPickerProps) {
  const id = useId()

  if (options.length === 1) {
    return (
      <p>
        Account: <strong>{options[0].label}</strong>
      </p>
    )
  }

  return (
    <p>
      <label htmlFor={id}>Account </label>
      <select
        id={id}
        value={selectedId ?? ''}
        onChange={(event) => onSelect(Number(event.target.value))}
      >
        {selectedId === null && (
          <option value="" disabled>
            Choose an account
          </option>
        )}
        {options.map(({ account, label }) => (
          <option key={account.id} value={account.id}>
            {label}
          </option>
        ))}
      </select>
    </p>
  )
}
