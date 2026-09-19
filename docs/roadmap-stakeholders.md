# GrepDocs Roadmap — What to Expect

GrepDocs gives you one place to browse, search, and edit documentation that's scattered across
many git repositories, and push edits straight back to source control. This page tracks what's
coming, grouped into **Now / Next / Later** — no fixed dates, just the order things arrive in.

A note on availability: a full web interface is part of the **Later** bucket. Everything in **Now**
and **Next** is being built as the underlying capability first; you'll be able to click through and
use it once the interface catches up.

## Now

- **Connect more than one account per provider.** Today you can link one GitHub account. Soon you
  can link several — for example a personal and a work account — and choose which one a
  repository comes from.
- **Choose which repositories and files to track.** Pick the repositories (and the specific
  documentation files inside them) GrepDocs should keep an eye on.

## Next

- **Read and edit documentation in place.** View rendered Markdown or the raw source, make edits,
  and preview changes before they go anywhere.
- **Publish edits back to the source repository.** Save a draft, then commit it back with your own
  message — with a safety check if the file changed upstream in the meantime.
- **Search across everything you track.** One search box across all your tracked documentation,
  not per-repository.

## Later

- **Organize repositories into groups.** Group related repositories together to keep large sets of
  documentation navigable.
- **A complete web interface.** Everything above, brought together in one application you use day
  to day, instead of building blocks under the hood.

## Not yet planned

- **Bitbucket and GitLab support.** GrepDocs is being built so additional providers can be added
  later; GitHub is the only one supported for now.
- **Sharing an account across multiple users.** Each linked account belongs to one person; team or
  shared accounts are a bigger question for later.
