import { useMemo, useState } from 'react'
import { NavLink } from 'react-router'
import type { Document } from '../../api/documents.ts'
import { ancestorPaths, buildTree, type TreeNode } from './tree.ts'

interface DocumentTreeProps {
  repositoryId: number
  fullName: string
  documents: Document[]
  // The document the URL names, when it is one of `documents`.
  selected: Document | undefined
}

// The documents as nested lists, directories as <details>. Top-level entries
// are always visible; a directory starts open when it holds the selected
// document, and the user's choice sticks while the tree stays mounted.
export function DocumentTree({
  repositoryId,
  fullName,
  documents,
  selected,
}: DocumentTreeProps) {
  const tree = useMemo(() => buildTree(documents), [documents])
  const [open, setOpen] = useState(
    () => new Set(selected ? ancestorPaths(selected.path) : []),
  )

  // A document selected from outside the tree (back, a link) opens its
  // directories, once per selection, leaving the others as they are.
  const [revealed, setRevealed] = useState(selected?.path)
  if (selected && selected.path !== revealed) {
    setRevealed(selected.path)
    setOpen((current) => new Set([...current, ...ancestorPaths(selected.path)]))
  }

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
    <nav className="document-tree" aria-label={`Documents in ${fullName}`}>
      <TreeList
        nodes={tree}
        repositoryId={repositoryId}
        open={open}
        onToggle={toggle}
      />
    </nav>
  )
}

interface TreeListProps {
  nodes: TreeNode[]
  repositoryId: number
  open: Set<string>
  onToggle: (path: string, isOpen: boolean) => void
}

function TreeList({ nodes, repositoryId, open, onToggle }: TreeListProps) {
  return (
    <ul>
      {nodes.map((node) => (
        <li key={`${node.kind}:${node.path}`}>
          {node.kind === 'directory' ? (
            <details
              open={open.has(node.path)}
              onToggle={(event) =>
                onToggle(node.path, event.currentTarget.open)
              }
            >
              <summary>{node.name}</summary>
              <TreeList
                nodes={node.children}
                repositoryId={repositoryId}
                open={open}
                onToggle={onToggle}
              />
            </details>
          ) : (
            <NavLink
              to={`/repositories/${repositoryId}/documents/${node.document.id}`}
            >
              {node.name}
            </NavLink>
          )}
        </li>
      ))}
    </ul>
  )
}
