import type { Repository } from '../../api/repositories.ts'

// The prefix the sanitizer gives every id and name from a document, and
// rehype-slug every heading ID, as GitHub does: an id like "location" would
// otherwise shadow a global of the page (DOM clobbering).
export const idPrefix = 'user-content-'

// Where a URL from a document points.
export type ResolvedLink =
  // Absolute, with a scheme (protocol-relative URLs get https:).
  | { kind: 'external'; href: string }
  // Inside the document: the fragment, already prefixed.
  | { kind: 'fragment'; fragment: string }
  // A file of the repository, from its root, with the query and fragment
  // as written (empty when absent).
  | { kind: 'path'; path: string; query: string; fragment: string }
  // Nowhere: above the repository's root, or not decodable.
  | { kind: 'invalid' }

// Classifies `href` from the document at `documentPath`. Relative paths
// resolve against the document's directory, and a leading "/" is the
// repository's root, as on GitHub. Paths are decoded, so they compare with
// document paths as stored.
export function resolveLink(documentPath: string, href: string): ResolvedLink {
  if (href.startsWith('//')) {
    return { kind: 'external', href: `https:${href}` }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return { kind: 'external', href }
  }

  const hashAt = href.indexOf('#')
  const fragment = hashAt === -1 ? '' : href.slice(hashAt + 1)
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt)
  const queryAt = beforeHash.indexOf('?')
  const pathPart = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt)
  const query = queryAt === -1 ? '' : beforeHash.slice(queryAt + 1)

  if (pathPart === '') {
    if (hashAt !== -1) {
      return { kind: 'fragment', fragment: prefixFragment(fragment) }
    }
    // Only a query, or nothing: the document itself.
    return { kind: 'path', path: documentPath, query, fragment: '' }
  }

  const segments = pathPart.startsWith('/')
    ? []
    : documentPath.split('/').slice(0, -1)
  for (const raw of pathPart.split('/')) {
    let segment: string
    try {
      segment = decodeURIComponent(raw)
    } catch {
      return { kind: 'invalid' }
    }
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return { kind: 'invalid' }
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return { kind: 'path', path: segments.join('/'), query, fragment }
}

// A fragment as the rendered document names it: with the id prefix, unless
// it already has it (a link written for GitHub's page).
export function prefixFragment(fragment: string): string {
  return fragment === '' || fragment.startsWith(idPrefix)
    ? fragment
    : idPrefix + fragment
}

// The app route of a document, as router.tsx nests it.
export function documentRoute(repoId: number, documentId: number): string {
  return `/repositories/${repoId}/documents/${documentId}`
}

// The URL of a file of the repository on its provider at `ref` (a commit or
// a branch): its page ("blob") or its content ("raw"). null for a provider
// whose URLs this does not know.
export function providerFileUrl(
  repository: Pick<Repository, 'provider' | 'html_url'>,
  ref: string,
  path: string,
  kind: 'blob' | 'raw',
): string | null {
  if (repository.provider !== 'github') {
    return null
  }
  return `${repository.html_url}/${kind}/${encodePath(ref)}/${encodePath(path)}`
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}
