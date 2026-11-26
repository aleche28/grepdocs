import {
  FolderGit2,
  LoaderCircle,
  TriangleAlert,
  UserRoundPlus,
} from 'lucide-react'
import { type ReactNode, useId, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  type AccountRepository,
  type ExternalAccount,
  type Provider,
  relinkUrl,
  useAccountRepositories,
  useAccounts,
  useProviders,
} from '../api/accounts.ts'
import { parseId } from '../api/ids.ts'
import { useRepositories, useTrackRepository } from '../api/repositories.ts'
import { ApiErrorMessage } from '../components/ApiErrorMessage.tsx'
import { accountName } from './accounts/format.ts'
import { type AccountOption, AccountPicker } from './track/AccountPicker.tsx'
import { ListError } from './track/ListError.tsx'
import { type OwnerAndName, ownerOf, repositoryKey } from './track/messages.ts'
import { PublicRepositoryForm } from './track/PublicRepositoryForm.tsx'
import { RepositoryList } from './track/RepositoryList.tsx'
import { TrackOutcome } from './track/TrackOutcome.tsx'
import { ExternalLink } from '../components/ExternalLink.tsx'

// An account the page can list repositories from, with its provider.
interface Selectable extends AccountOption {
  provider: Provider
}

// /repositories/track: track a repository from a linked account's list, on
// its default branch (changing the branch is the repositories page's job).
// The selected account is kept in ?account_id=, so a reload keeps it.
export function TrackRepositoryPage() {
  const providers = useProviders()
  const accounts = useAccounts()
  const tracked = useRepositories()
  const track = useTrackRepository()
  const [searchParams, setSearchParams] = useSearchParams()
  const sectionHeadingId = useId()
  const publicHeadingId = useId()
  // Takes focus after a success, when the Track button that had it is gone.
  const outcomeRef = useRef<HTMLDivElement>(null)

  const selectable = useMemo(
    () => selectableAccounts(providers.data, accounts.data),
    [providers.data, accounts.data],
  )
  const requestedId = parseId(searchParams.get('account_id'))
  // An ID naming no account (unlinked meanwhile, or typed by hand) is no
  // selection; a single account needs none.
  const selected =
    selectable.find((option) => option.account.id === requestedId) ??
    (selectable.length === 1 ? selectable[0] : null)
  // A token known to be dead is not used: the user must re-link first.
  const listed =
    selected && !selected.account.needs_relink ? selected.account : null
  const repositories = useAccountRepositories(listed)

  // While the tracked list is loading or failed, every row offers Track; a
  // 409 covers the rest.
  const trackedKeys = useMemo(
    () => new Set((tracked.data ?? []).map(repositoryKey)),
    [tracked.data],
  )

  const select = (accountId: number) =>
    setSearchParams(
      (current) => {
        // A copy: current may be the router's own memoized object.
        const params = new URLSearchParams(current)
        params.set('account_id', String(accountId))
        return params
      },
      { replace: true },
    )

  const trackFromList = (
    account: ExternalAccount,
    repository: AccountRepository,
  ) =>
    track.mutate(
      {
        provider: repository.provider,
        owner: ownerOf(repository),
        name: repository.name,
        account_id: account.id,
      },
      { onSuccess: () => outcomeRef.current?.focus() },
    )

  const trackPublic = (repository: OwnerAndName, onSuccess: () => void) =>
    track.mutate({ provider: 'github', ...repository }, { onSuccess })

  // The owner/name rules of the public form are GitHub's.
  const publicProvider = providers.data?.find((p) => p.name === 'github')

  let content
  if (providers.data && accounts.data) {
    if (selectable.length === 0) {
      const only = providers.data.length === 1 ? providers.data[0] : null
      content = (
        <div className="empty-state">
          <span className="empty-icon">
            <UserRoundPlus size={20} />
          </span>
          <h3>No linked accounts</h3>
          <p>
            Link {only ? `a ${only.display_name} account` : 'an account'} to
            track its repositories, or track a public repository below.
          </p>
          <Link to="/settings/accounts" className="button primary">
            Go to linked accounts
          </Link>
        </div>
      )
    } else {
      const picker = (
        <AccountPicker
          options={selectable}
          selectedId={selected?.account.id ?? null}
          onSelect={select}
        />
      )
      content = selected ? (
        <AccountRepositories
          selected={selected}
          picker={picker}
          repositories={repositories}
          list={(data) => (
            <RepositoryList
              // A fresh filter per account.
              key={selected.account.id}
              picker={picker}
              repositories={data}
              trackedKeys={trackedKeys}
              busy={track.isPending}
              pending={
                track.isPending &&
                track.variables.account_id === selected.account.id
                  ? `${track.variables.owner}/${track.variables.name}`
                  : null
              }
              onTrack={(repository) =>
                trackFromList(selected.account, repository)
              }
            />
          )}
        />
      ) : (
        <ListCard picker={picker}>
          <p className="list-card-note">
            Choose an account to see its repositories.
          </p>
        </ListCard>
      )
    }
  } else if (providers.error || accounts.error) {
    content = (
      <ApiErrorMessage
        error={providers.error ?? accounts.error}
        title="Could not load your linked accounts"
        onRetry={() => {
          if (providers.error) void providers.refetch()
          if (accounts.error) void accounts.refetch()
        }}
      />
    )
  } else {
    content = (
      <div className="empty-state loading">
        <LoaderCircle className="spin" size={16} />
        <p>Loading accounts…</p>
      </div>
    )
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Track a repository</h1>
          <p className="page-subtitle">
            {/* The full line while the providers load, so it does not change
                in the common case. */}
            {providers.data && !publicProvider
              ? 'Pick one from a linked account.'
              : 'Pick one from a linked account, or enter any public repository.'}
          </p>
        </div>
      </div>
      <div ref={outcomeRef} tabIndex={-1}>
        <TrackOutcome
          track={track}
          providers={providers.data ?? []}
          accounts={accounts.data ?? []}
        />
      </div>
      <section aria-labelledby={sectionHeadingId} className="track-section">
        <h2 id={sectionHeadingId}>From a linked account</h2>
        {content}
      </section>
      {publicProvider && (
        <section aria-labelledby={publicHeadingId} className="track-section">
          <h2 id={publicHeadingId}>A public repository</h2>
          <PublicRepositoryForm
            providerDisplayName={publicProvider.display_name}
            busy={track.isPending}
            pending={
              track.isPending && track.variables.account_id === undefined
            }
            onTrack={trackPublic}
          />
        </section>
      )}
    </>
  )
}

interface AccountRepositoriesProps {
  selected: Selectable
  // The account picker, in the card's header.
  picker: ReactNode
  repositories: ReturnType<typeof useAccountRepositories>
  // Renders a non-empty list, in its own card.
  list: (repositories: AccountRepository[]) => ReactNode
}

// The selected account's repositories, or why they cannot be shown.
function AccountRepositories({
  selected,
  picker,
  repositories,
  list,
}: AccountRepositoriesProps) {
  const { account, label, provider } = selected
  const displayName = provider.display_name
  const installLink = provider.install_url && (
    <ExternalLink href={provider.install_url}>
      Manage the {displayName} App's repository access
    </ExternalLink>
  )

  if (account.needs_relink) {
    return (
      <ListCard picker={picker}>
        <div className="list-card-body">
          <div className="warning with-icon">
            <TriangleAlert className="notice-icon" size={16} />
            <p>The access of {label} expired.</p>
            <a
              href={relinkUrl(account.provider, account.id)}
              className="button primary"
            >
              Re-link {label}
            </a>
          </div>
        </div>
      </ListCard>
    )
  }
  if (repositories.data) {
    if (repositories.data.length === 0) {
      return (
        <ListCard picker={picker}>
          <div className="empty-state">
            <span className="empty-icon">
              <FolderGit2 size={20} />
            </span>
            <p>
              The {displayName} App can't see any repository of {label} yet.
            </p>
            {provider.install_url && (
              <ExternalLink href={provider.install_url} className="button">
                Manage the {displayName} App's repository access
              </ExternalLink>
            )}
          </div>
        </ListCard>
      )
    }
    return (
      <>
        {list(repositories.data)}
        {installLink && (
          <p className="list-card-footer">
            Don't see a repository? {installLink}
          </p>
        )}
      </>
    )
  }
  if (repositories.error) {
    return (
      <ListCard picker={picker}>
        <div className="list-card-body">
          <ListError
            error={repositories.error}
            account={account}
            accountName={label}
            providerDisplayName={displayName}
            onRetry={() => void repositories.refetch()}
          />
        </div>
      </ListCard>
    )
  }
  return (
    <ListCard picker={picker}>
      <div className="empty-state loading">
        <LoaderCircle className="spin" size={16} />
        <p>Loading repositories…</p>
      </div>
    </ListCard>
  )
}

// The card the account's repositories show in, with the picker in its
// header, for every state but the list (RepositoryList has its own, with the
// filter beside the picker).
function ListCard({
  picker,
  children,
}: {
  picker: ReactNode
  children: ReactNode
}) {
  return (
    <div className="list-card">
      <div className="list-card-header">{picker}</div>
      {children}
    </div>
  )
}

// The linked accounts whose provider the API lists, in GET /accounts order,
// labelled as on the accounts page (plus the provider when there are
// several). Accounts of a provider no longer configured cannot list
// repositories.
function selectableAccounts(
  providers: Provider[] | undefined,
  accounts: ExternalAccount[] | undefined,
): Selectable[] {
  if (!providers || !accounts) {
    return []
  }
  const byName = new Map(providers.map((p) => [p.name, p]))
  return accounts.flatMap((account) => {
    const provider = byName.get(account.provider)
    if (!provider) {
      return []
    }
    const name = accountName(account, provider.display_name)
    const label =
      providers.length > 1 ? `${name} (${provider.display_name})` : name
    return [{ account, label, provider }]
  })
}
