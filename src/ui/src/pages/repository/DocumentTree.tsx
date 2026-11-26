import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Search,
} from 'lucide-react'
import { type CSSProperties, memo, useId, useMemo, useState } from 'react'
import { NavLink } from 'react-router'
import type { Document } from '../../api/documents.ts'
import { documentRoute } from './links.ts'
import { ancestorPaths, buildTree, filterTree, type TreeNode } from './tree.ts'

interface DocumentTreeProps {
  repositoryId: number
  fullName: string
  documents: Document[]
  // The document the URL names, when it is one of `documents`.
  selected: Document | undefined
}

// A filter box and the documents as nested lists, directories as <details>.
// Top-level entries are always visible; a directory starts open when it
// holds the selected document, and the user's choice sticks while the tree
// stays mounted. While the filter has text, only the documents whose path
// matches are listed, with every directory open.
// Memoized: the page re-renders on every poll of the repositories while a
// sync runs, and none of the tree's props change then.
export const DocumentTree = memo(function DocumentTree({
  repositoryId,
  fullName,
  documents,
  selected,
}: DocumentTreeProps) {
  const tree = useMemo(() => buildTree(documents), [documents])
  const [open, setOpen] = useState(() => new Set<string>())
  const [query, setQuery] = useState('')
  const filterId = useId()

  // The selected document opens its directories, once per selection (on the
  // first render, or when it comes from outside the tree: back, a link),
  // leaving the others as they are.
  const [revealed, setRevealed] = useState<string>()
  if (selected && selected.path !== revealed) {
    setRevealed(selected.path)
    setOpen((current) => new Set([...current, ...ancestorPaths(selected.path)]))
  }

  const filtering = query.trim() !== ''
  const shown = useMemo(() => filterTree(tree, query), [tree, query])

  const toggle = (path: string, isOpen: boolean) =>
    setOpen((current) => {
      if (current.has(path) === isOpen) {
        return current
      }
      const next = new Set(current)
      if (isOpen) {
        next.add(path)
      } else {
        next.delete(path)
      }
      return next
    })

  return (
    <>
      <div className="tree-filter">
        <label htmlFor={filterId} className="visually-hidden">
          Filter documents
        </label>
        <Search size={14} />
        <input
          id={filterId}
          type="search"
          placeholder="Filter documents"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <nav className="document-tree" aria-label={`Documents in ${fullName}`}>
        {shown.length > 0 ? (
          <TreeList
            nodes={shown}
            depth={0}
            repositoryId={repositoryId}
            // While filtering, every directory left is open: each holds a
            // match. The user's own choices come back when the filter clears.
            isOpen={filtering ? () => true : (path) => open.has(path)}
            onToggle={filtering ? undefined : toggle}
          />
        ) : (
          <p className="tree-empty">No documents match “{query.trim()}”.</p>
        )}
      </nav>
    </>
  )
})

interface TreeListProps {
  nodes: TreeNode[]
  // How deep the list is nested, for the rows' indentation.
  depth: number
  repositoryId: number
  isOpen: (path: string) => boolean
  // Unset while filtering, when a toggle is not remembered.
  onToggle: ((path: string, isOpen: boolean) => void) | undefined
}

function TreeList({
  nodes,
  depth,
  repositoryId,
  isOpen,
  onToggle,
}: TreeListProps) {
  // The rows indent with their depth, so their hover and selected
  // backgrounds span the whole width of the tree.
  const style = { '--depth': depth } as CSSProperties
  return (
    <ul>
      {nodes.map((node) => (
        <li key={node.path}>
          {node.kind === 'directory' ? (
            <details
              open={isOpen(node.path)}
              onToggle={(event) =>
                onToggle?.(node.path, event.currentTarget.open)
              }
            >
              <summary className="tree-row" style={style}>
                <ChevronRight className="tree-chevron" size={14} />
                <Folder className="tree-icon closed" size={15} />
                <FolderOpen className="tree-icon opened" size={15} />
                <span className="tree-name">{node.name}</span>
              </summary>
              <TreeList
                nodes={node.children}
                depth={depth + 1}
                repositoryId={repositoryId}
                isOpen={isOpen}
                onToggle={onToggle}
              />
            </details>
          ) : (
            <NavLink
              to={documentRoute(repositoryId, node.document.id)}
              className="tree-row"
              style={style}
            >
              <span className="tree-chevron" />
              <FileText className="tree-icon" size={15} />
              <span className="tree-name">{node.name}</span>
            </NavLink>
          )}
        </li>
      ))}
    </ul>
  )
}
