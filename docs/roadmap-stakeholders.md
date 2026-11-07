# GrepDocs Roadmap — What to Expect

GrepDocs gives you one place to browse, search, and edit documentation that's scattered across
many git repositories, and push edits straight back to source control. This page tracks what's
coming, grouped into **Now / Next / Later** — no fixed dates, just the order things arrive in.

A note on availability: the first version of the web interface is in **Next**. It focuses on
reading documentation; editing, search, and groups arrive afterwards, each with its own screens.

## Now

- **Connect more than one account per provider.** You can link several GitHub accounts — for
  example a personal and a work account — and choose which one a repository comes from.
- **Safer, finer-grained GitHub access.** GrepDocs now connects to GitHub as an installable app:
  you choose exactly which repositories it can see (or all of them, in one click), it only asks
  for the access it needs to read and update documentation, and its access renews automatically
  instead of relying on a permanent key. Unlinking an account also cuts off GrepDocs' access to it
  on GitHub's side.
- **Choose which repositories to track.** You can pick the repositories GrepDocs should keep an
  eye on, and the branch to follow in each.
- **Bring in the latest documentation on demand.** Ask GrepDocs to update a tracked repository and
  it pulls in the current Markdown documentation from the branch you follow, in the background,
  and tells you whether it worked and when it happened — and if not, what to do about it (for
  example, reconnect your account).

## Next

- **A first web app for reading documentation.** Sign in, connect GitHub, pick repositories, and
  browse and read their documentation — formatted or as plain source — in one place.

## Later

- **Choose which files count as documentation.** Include or exclude specific files and folders
  instead of every Markdown file in the repository.
- **Edit documentation and publish it back.** Edit with a live preview, review your changes, and
  commit them to the source repository with your own message — with a safety check if the file
  changed upstream in the meantime.
- **Search across everything you track.** One search box across all your tracked documentation,
  not per-repository.
- **Organize repositories into groups.** Group related repositories together to keep large sets of
  documentation navigable.

## Not yet planned

- **Bitbucket and GitLab support.** GrepDocs is being built so additional providers can be added
  later; GitHub is the only one supported for now.
- **Automatic updates.** Keeping documentation up to date without asking, for example whenever the
  repository changes.
- **Signing in with more than one identity.** For example email and GitHub, merged into one
  account. Suggested by the community and under consideration.
- **Sharing an account across multiple users.** Each linked account belongs to one person; team or
  shared accounts are a bigger question for later.
