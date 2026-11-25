# PRD: Document viewer with rendered and raw modes (#71)

Status: **proposed**. Milestone: Phase 4 — Read-only MVP. Replaces user stories S4.1 (view
rendered Markdown), S4.2 (view raw Markdown) and S4.4 (see a document's repository and branch).

## Problem

A user can open a repository and pick a document from its tree (#70), but the right-hand column
only prints the document's ID: `DocumentPage` (`src/ui/src/pages/DocumentPage.tsx`) is a
placeholder. The API already returns a document with its content (`GET /documents/{id}`,
`docs/api.md` → Documents), so reading documentation, which is the point of Phase 4, is missing only
its screen.

## Goals

- Show the selected document rendered as Markdown the way GitHub shows it: GitHub Flavored
  Markdown, and the same subset of inline HTML (S4.1).
- Show the exact Markdown source on request (S4.2).
- Say where the document comes from: path, repository, branch, the synced commit, and a link to
  the file on GitHub (S4.4).
- Never run anything from the document. Its content comes from a repository the user tracks, not
  from the user, so it is untrusted.
- Keep links inside the documentation working: a relative link to another synced document opens
  it in the viewer.

## Non-goals

- **Server-side rendering** (`GET /documents/{id}/rendered`): the roadmap keeps it out of this
  phase. Rendering in the browser also gives Phase 6's editor its live preview for free.
- **Syntax highlighting, Mermaid, math, and front matter**: code blocks show as plain monospace
  text, and YAML front matter shows as plain Markdown (a rule, then its last line as a heading),
  where GitHub shows a table. Candidates for follow-ups (see Follow-up issues).
- **Serving images and other non-Markdown files through the API**: the sync stores only `.md`
  files. Relative images point at GitHub (D5), with the limits listed under Risks.
- **Keeping the mode across documents**: a link in the tree opens the rendered view (D3).
- **Copy or download buttons** for the raw view.
- **Drafts** (`has_draft`, draft content): Phase 6.

No API change, migration, or OpenAPI change.

## Decisions

| #   | Topic              | Decision                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Renderer           | `react-markdown` with `remark-gfm`, `rehype-raw`, `rehype-sanitize` (its `defaultSchema`, which follows GitHub's allow-list), then `rehype-slug`. It builds React elements from a syntax tree: no `dangerouslySetInnerHTML` and no HTML string anywhere. Rejected: `marked` + `DOMPurify`, which is correct only as long as every render goes through the sanitizer on the way to `innerHTML`. |
| D2  | Inline HTML        | Allowed, but only what `defaultSchema` keeps (`<details>`, `<summary>`, `<img>`, `<kbd>`, `<sub>`, `align` and the like). Scripts, event handlers, `style`, `<iframe>`, forms and `javascript:` URLs are removed. A README written for GitHub looks the same here.                                                                                                                             |
| D3  | Mode               | In the URL: `?view=raw` shows the source; no parameter (or any other value) shows the rendered document. Two links, "Rendered" and "Raw", switch it with `replace`, so the back button does not step through mode changes. Tree links carry no parameter, so another document opens rendered.                                                                                                  |
| D4  | Raw content        | From `content` of `GET /documents/{id}`, the same response as the rendered view: one request per document, and switching modes sends none. `GET /documents/{id}/raw` is not used. Shown in `<pre><code>`, as text.                                                                                                                                                                             |
| D5  | Links and images   | Relative URLs resolve against the document's directory. A link to a synced document opens it in the viewer (fragment kept). Any other relative link goes to the file on GitHub at the synced commit; a relative image loads from GitHub at that commit. Absolute links open in a new tab. Fragment-only links (`#install`) point at the prefixed heading IDs (D6).                             |
| D6  | Heading anchors    | `rehype-slug` gives headings GitHub's IDs with GitHub's `user-content-` prefix, and runs after the sanitizer, which adds the same prefix to IDs and names from inline HTML. The prefix stops an ID from shadowing a global of the page (DOM clobbering). `#install` becomes `#user-content-install`.                                                                                           |
| D7  | Origin             | Above the document: its path as the `<h2>`, the branch, the short commit (7 characters) and the sync date, and "View on GitHub ↗" to the file at that commit. The repository's name and link stay in the page header from #70.                                                                                                                                                                 |
| D8  | Data and refresh   | `useDocument(repoId, documentId)` under `[...documentsQueryKey(repoId), 'document', id]`, `staleTime: Infinity`. `useRepositories` already invalidates `documentsQueryKey(repoId)` when a sync succeeds, and untracking removes it; both match the detail by prefix, so the open document refreshes after a sync and goes away on untrack with no new code.                                    |
| D9  | Repository context | `RepositoryPage` renders the outlet only once the repository is found, and passes `{ repository, documents }` to it with `useOutlet(context)`. `DocumentPage` reads them with `useOutletContext` and never handles a missing repository itself.                                                                                                                                                |
| D10 | Bundle             | The rendered view (`MarkdownView`) is loaded with `React.lazy`, so the Markdown libraries are a separate chunk downloaded the first time a document is rendered, and sign-in and the repositories pages do not pay for them. The raw view does not load it.                                                                                                                                    |
| D11 | Provider URLs      | One function, `documentUrls(repository, document)`, returns the URLs of a file and of a raw file on the provider, or `null` for a provider it does not know. For GitHub: `{html_url}/blob/{commit}/{path}` and `{html_url}/raw/{commit}/{path}`, each path segment encoded. With `null`, no "View on GitHub" link is shown and relative links and images are left out.                         |
| D12 | Delivery           | One PR, UI only. New runtime dependencies: `react-markdown`, `remark-gfm`, `rehype-raw`, `rehype-sanitize`, `rehype-slug`. `make ui-audit` must pass with them.                                                                                                                                                                                                                                |

## UI

### Data

All through TanStack Query and `apiFetch`:

- `DocumentDetail` in `src/ui/src/api/documents.ts`: `Document` plus `content: string`, as in
  `docs/api.md` → `GET /api/documents/{id}`.
- `useDocument(repoId, documentId)` ← `GET /documents/{id}`, with `skipToken` while `documentId`
  is `null`. The key is `documentQueryKey(repoId, documentId)` (D8), exported next to
  `documentsQueryKey`.
- The repository and the documents list come from `RepositoryPage` through the outlet context (D9).
  The list is used only to know which relative links point at synced documents (D5); while it is
  loading, those links go to GitHub.

### Layout

```
┌ Documents in acme/docs ──┐  ┌─────────────────────────────────────────────────┐
│ ▾ docs                   │  │ docs/guides/10-faq.md                           │
│   ▾ guides               │  │ Branch main · Commit abcd123 · Synced Nov 25,   │
│     · 2-setup.md         │  │ 2026, 10:12 · View on GitHub ↗                  │
│     · 10-faq.md   ◀ sel. │  │                                                 │
│ · README.md              │  │ [Rendered] [Raw]                                │
└──────────────────────────┘  │ ─────────────────────────────────────────────── │
                              │ # FAQ                                           │
                              │ The rendered document, or its source in a <pre> │
                              └─────────────────────────────────────────────────┘
```

- The "Rendered" and "Raw" links sit in a `<nav aria-label="View">`; the current one has
  `aria-current="page"`.
- The rendered document is in an `<article className="markdown">`. Its styles go in
  `src/ui/src/index.css` (headings, lists, tables with borders, blockquotes, inline code and code
  blocks scrolling sideways, images at most 100% wide), not from a stylesheet package.
- The raw view keeps line breaks and scrolls sideways rather than wrapping.

### Links and images (D5)

A pure function, `resolveLink(documentPath, href)` in `pages/repository/links.ts`, classifies each
URL and is tested on its own:

| `href` in the document (from `docs/guides/faq.md`)      | Result                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `#install`                                              | `#user-content-install`, same page                                                            |
| `setup.md`, `./setup.md#step-2`                         | `docs/guides/setup.md` → if synced, `/repositories/:repoId/documents/:id#user-content-step-2` |
| `../../README.md`, `/README.md`                         | `README.md` from the repository root (a leading `/` is the root, as on GitHub)                |
| `../img/arch.png`, a relative link to a non-synced file | GitHub blob URL at the synced commit, new tab; for an `<img>`, the GitHub raw URL             |
| `../../../outside.md` (above the root)                  | Left as text: the link is dropped, its text kept                                              |
| `https://…`, `mailto:…`                                 | Unchanged; `https` links open in a new tab with `rel="noopener noreferrer"`                   |
| `javascript:…`, `data:…`, other schemes                 | Removed (react-markdown's `defaultUrlTransform`, then the sanitizer)                          |

- Paths are URL-decoded before matching (`my%20doc.md` matches `my doc.md`) and matched to
  document paths exactly, case included, as git does.
- An internal link is a React Router `<Link>`, so opening another document keeps the tree mounted,
  as a click in the tree does.

### States

| Situation                                       | Right column                                                                           |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| `:documentId` not a positive integer            | "Document not found." No request.                                                      |
| Loading                                         | "Loading document…" (also the `Suspense` fallback while `MarkdownView` downloads)      |
| `404 not_found`, also on a refetch after a sync | "Document not found. The last sync may have removed it." The error wins over old data. |
| Any other error                                 | `ApiErrorMessage` with _Try again_; on a failed refetch, the document stays            |
| The document's `repository_id` is not `:repoId` | "This document is in another repository." with a link to its own URL                   |
| Empty `content`                                 | "This document is empty." in both views                                                |
| Repository syncing or failed                    | The document, unchanged: the page header already says it is the last good sync's       |

## Tests

Vitest + Testing Library + MSW, through `renderRoute`, endpoints from `apiUrl()`:

- `src/ui/src/pages/repository/links.test.ts`: every row of the links table, encoded paths, a
  leading `/`, paths above the root, a fragment on a relative link.
- `src/ui/src/api/documents.test.tsx`: `useDocument` requests the right ID and sits under the
  repository's key (a sync invalidation refetches it, an untrack removes it).
- `src/ui/src/pages/DocumentPage.test.tsx`:
  - Rendering: headings with prefixed IDs, a GFM table, a task list, strikethrough, autolinks,
    `<details>` from inline HTML.
  - Sanitizing: `<script>`, an `<img onerror>`, `<iframe>`, `style`, and a `javascript:` link in the
    source leave no element, attribute or URL behind.
  - Raw: `?view=raw` shows the exact source (inline HTML as text); the links switch modes and mark
    the current one.
  - Origin: path, branch, short commit, and the GitHub URL with an encoded path at the commit.
  - Links: a relative link to a synced document navigates inside the app without remounting the
    tree; one to a non-synced file and an external link open in a new tab; a relative image
    points at GitHub's raw URL.
  - Every row of the States table; an invalid ID sends no request.
  - A sync that ends with a new `last_sync_at` refetches the open document.
- Fixtures: a `documentDetail()` factory and a handler for `GET /documents/:id` in
  `src/test/documents.tsx`, next to `trackedDocument()` and `mockDocumentsApi`.

## Docs

- `AGENTS.md`: the document page in the list of what the UI tests cover.
- This PRD: an "As built" section with any differences, and the status set to **done**.
- `docs/roadmap.md` / `docs/roadmap-stakeholders.md`: run `phase-status-sync` once it lands.

## Acceptance criteria

1. Opening a document from the tree shows it rendered: GFM tables, task lists, and inline HTML
   from GitHub's allow-list look as they do on GitHub.
2. No script, event handler, iframe, inline style, or `javascript:` URL from a document reaches
   the page.
3. "Raw" shows the exact Markdown source, and `?view=raw` opens it directly.
4. The document shows its path, branch, synced commit and sync date, and links to the file on
   GitHub at that commit.
5. A relative link to another synced document opens it in the viewer, keeping the tree as it was;
   a fragment link scrolls to its heading.
6. A document removed by a sync, an unknown ID, and a document from another repository each show
   their message, not an empty page.
7. When a sync of the repository succeeds while the document is open, it shows the new content
   without a reload.
8. The Markdown libraries are not in the bundle that loads the sign-in and repositories pages.
9. `make ui-ci` passes, with the new tests, and `make ui-audit` with the new dependencies.

## Risks and things to verify manually

- **Images from private repositories** load from `github.com/{owner}/{repo}/raw/…`, which works
  only while the browser is signed in to GitHub with access to the repository. Otherwise the image
  shows its alt text. Check with a private repository, signed in and signed out. Serving images
  through the API would need the sync to store non-Markdown files (Phase 5's file tree).
- **External images** load straight from their host, which then sees the user's IP address and
  that the document was opened (GitHub hides this behind its image proxy). Acceptable for
  documentation the user chose to track; an image proxy is a follow-up if it matters.
- **Large documents** render on the main thread. Try a Markdown file of a few MB (a long
  changelog). If it freezes the page, render the raw view by default above a size limit.
- **GitHub fidelity:** check a README that uses `<p align="center">`, `<picture>`, emoji
  shortcodes and alerts (`> [!NOTE]`). `defaultSchema` drops `<picture>`'s `<source>`, and alerts
  and shortcodes are GitHub extensions `remark-gfm` does not cover; they show as plain blockquotes
  and text. Decide whether any is worth a follow-up.
- **Old branch under the new name** (from #70's risks): between a branch change and the next
  sync, the document's `branch` is the new one while its content and `upstream_commit` are the old
  branch's. The links use the commit, so they stay correct; only the "Branch" label is wrong.

## Follow-up issues

None planned yet. Candidates to propose if the risks above show up in practice: syntax
highlighting for code blocks, GitHub alerts and emoji shortcodes, front matter as a table, an
image proxy, and a size limit for rendering.

Related open issues: #64 (CORS and rate limiting), #119 (Google sign-in failures).
