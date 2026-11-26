import {
  type ComponentProps,
  memo,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import Markdown, {
  type Components,
  defaultUrlTransform,
  type ExtraProps,
  type Options,
} from 'react-markdown'
import { Link, useLocation } from 'react-router'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import { idPrefix, prefixFragment, resolveLink } from './links.ts'

// Where the links of a document go, from DocumentPage.
export interface LinkTargets {
  // The app route of the synced document at `path` (from the repository's
  // root), or null when no document has that path.
  documentRoute: (path: string) => string | null
  // The file at `path` on the provider, at the synced commit, or null for a
  // provider without file URLs.
  fileUrl: (path: string, kind: 'blob' | 'raw') => string | null
}

interface MarkdownViewProps {
  content: string
  // The document's path, which relative URLs resolve against.
  path: string
  links: LinkTargets
}

interface MarkdownContentProps extends MarkdownViewProps {
  articleRef: RefObject<HTMLElement | null>
}

// The rendered document, then its table of contents. Loaded lazily
// (DocumentPage), so the Markdown libraries are a chunk of their own. It
// follows the URL's fragment here, outside the memoized MarkdownContent, so
// a click on a heading link does not parse the document again.
export default function MarkdownView(props: MarkdownViewProps) {
  const { content, path, links } = props
  const articleRef = useRef<HTMLElement>(null)
  const [headings, setHeadings] = useState<Heading[]>([])
  useScrollToFragment(path)

  // Read from the rendered article, on the props MarkdownContent renders
  // from: the ids are the ones the sanitizer and rehype-slug gave, prefixed,
  // headings from inline HTML included. Before paint, so the table does not
  // appear a frame late.
  useLayoutEffect(() => {
    setHeadings(readHeadings(articleRef.current))
  }, [content, path, links])

  return (
    <>
      <MarkdownContent {...props} articleRef={articleRef} />
      <TableOfContents headings={headings} />
    </>
  )
}

// An h2 or h3 of the document, for the table of contents.
interface Heading {
  id: string
  text: string
  level: 2 | 3
}

function readHeadings(article: HTMLElement | null): Heading[] {
  if (!article) {
    return []
  }
  const headings: Heading[] = []
  for (const element of article.querySelectorAll('h2[id], h3[id]')) {
    const text = element.textContent?.trim() ?? ''
    // The footnotes' own heading, which GitHub hides, is not a section.
    if (text === '' || element.closest('section[data-footnotes]')) {
      continue
    }
    headings.push({
      id: element.id,
      text,
      level: element.tagName === 'H2' ? 2 : 3,
    })
  }
  return headings
}

// "On this page": a link to each heading, which scrolls there the way a
// heading link in the document does (the URL's fragment changes, and
// useScrollToFragment follows it). Nothing when there are no headings.
function TableOfContents({ headings }: { headings: Heading[] }) {
  const titleId = useId()
  if (headings.length === 0) {
    return null
  }
  return (
    <nav className="toc" aria-labelledby={titleId}>
      <p id={titleId} className="toc-title">
        On this page
      </p>
      <ul>
        {headings.map((heading) => (
          <li key={heading.id} className={`toc-level-${heading.level}`}>
            <a href={`#${heading.id}`}>{heading.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// GitHub Flavored Markdown, with the inline HTML GitHub allows, as React
// elements: the document is untrusted, so nothing reaches the DOM as an HTML
// string. In order:
// - remark-rehype keeps raw HTML, which rehype-raw parses into elements;
// - rehype-sanitize removes what GitHub's allow-list does not have (scripts,
//   event handlers, style, iframes, unsafe URLs) and prefixes every id and
//   name with idPrefix. remark-rehype's own prefix for footnote IDs is turned
//   off, or they would get it twice;
// - rehype-slug gives headings GitHub's IDs, with the same prefix;
// - urlTransform, which react-markdown runs last, points relative URLs at the
//   app or the provider (resolveLink).
const remarkPlugins: Options['remarkPlugins'] = [remarkGfm]
const remarkRehypeOptions: Options['remarkRehypeOptions'] = {
  clobberPrefix: '',
}
const rehypePlugins: Options['rehypePlugins'] = [
  rehypeRaw,
  [rehypeSanitize, { ...defaultSchema, clobberPrefix: idPrefix }],
  [rehypeSlug, { prefix: idPrefix }],
]

// Memoized: react-markdown parses on every render, and the page re-renders
// on every poll while a sync runs.
const MarkdownContent = memo(function MarkdownContent({
  content,
  path,
  links,
  articleRef,
}: MarkdownContentProps) {
  return (
    <article className="markdown" ref={articleRef}>
      <Markdown
        remarkPlugins={remarkPlugins}
        remarkRehypeOptions={remarkRehypeOptions}
        rehypePlugins={rehypePlugins}
        urlTransform={(url, key) => transformUrl(url, key, path, links)}
        components={components}
      >
        {content}
      </Markdown>
    </article>
  )
})

// A URL of the document at `path`, for its `key` attribute (href, src):
// absolute ones as they are, relative ones to the synced document or the
// provider's file, unsafe or unresolvable ones dropped (null).
function transformUrl(
  url: string,
  key: string,
  path: string,
  links: LinkTargets,
): string | null {
  const safe = defaultUrlTransform(url)
  if (safe === '') {
    return null
  }
  const link = resolveLink(path, safe)
  switch (link.kind) {
    case 'external':
      return link.href
    case 'fragment':
      return `#${link.fragment}`
    case 'invalid':
      return null
  }
  if (key === 'src') {
    return withQuery(links.fileUrl(link.path, 'raw'), link.query)
  }
  const route = links.documentRoute(link.path)
  if (route !== null) {
    return withFragment(route, prefixFragment(link.fragment))
  }
  const blob = withQuery(links.fileUrl(link.path, 'blob'), link.query)
  return blob && withFragment(blob, link.fragment)
}

function withQuery(url: string | null, query: string): string | null {
  return url && query ? `${url}?${query}` : url
}

function withFragment(url: string, fragment: string): string {
  return fragment ? `${url}#${fragment}` : url
}

const components: Components = { a: MarkdownLink }

// After urlTransform, an href starting with "/" is a route of the app, one
// starting with "#" is inside the document, and anything else is absolute.
// An <a> without href (a dropped URL, or an anchor from inline HTML) stays
// an <a>, keeping its text and its name.
function MarkdownLink({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- react-markdown's syntax tree node, not an attribute
  node,
  href,
  ...props
}: ComponentProps<'a'> & ExtraProps) {
  if (href?.startsWith('/')) {
    return <Link to={href} {...props} />
  }
  if (href && /^https?:/i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props} />
    )
  }
  return <a href={href} {...props} />
}

// A document opened with a fragment (a link from another document, or a
// full page load) scrolls to its heading once rendered: the browser looked
// for it before the content arrived. Once per document and fragment, so a
// refetch after a sync does not move the reader.
function useScrollToFragment(path: string) {
  const { hash } = useLocation()

  useEffect(() => {
    if (hash.length < 2) {
      return
    }
    let id: string
    try {
      id = decodeURIComponent(hash.slice(1))
    } catch {
      return
    }
    document.getElementById(id)?.scrollIntoView()
  }, [hash, path])
}
