import type { Document } from '../../api/documents.ts'

// A repository's documents as a directory tree, built from their paths.
export interface TreeDirectory {
  kind: 'directory'
  name: string
  // From the repository root, without a trailing slash: "docs/guides".
  path: string
  children: TreeNode[]
}

export interface TreeFile {
  kind: 'file'
  name: string
  path: string
  document: Document
}

export type TreeNode = TreeDirectory | TreeFile

// Natural order, ignoring case: "2-setup.md" before "10-faq.md", "api"
// next to "API".
const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

// Ties under the collator ("Docs" and "docs") fall back to code-point order,
// so the result does not depend on the API's order.
function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.kind !== b.kind) {
    return a.kind === 'directory' ? -1 : 1
  }
  return compareNames(a.name, b.name)
}

// Directories first, then files, each sorted by name.
export function buildTree(documents: Document[]): TreeNode[] {
  const root: TreeDirectory = {
    kind: 'directory',
    name: '',
    path: '',
    children: [],
  }
  // Every directory by path, so each is created once.
  const directories = new Map<string, TreeDirectory>([['', root]])

  for (const document of documents) {
    const segments = document.path.split('/')
    const name = segments.pop()!
    let parent = root
    for (const segment of segments) {
      const path = parent.path ? `${parent.path}/${segment}` : segment
      let directory = directories.get(path)
      if (!directory) {
        directory = { kind: 'directory', name: segment, path, children: [] }
        directories.set(path, directory)
        parent.children.push(directory)
      }
      parent = directory
    }
    parent.children.push({ kind: 'file', name, path: document.path, document })
  }

  for (const directory of directories.values()) {
    directory.children.sort(compareNodes)
  }
  return root.children
}

// The directories that hold a path, outermost first:
// "docs/guides/setup.md" → ["docs", "docs/guides"].
export function ancestorPaths(path: string): string[] {
  const segments = path.split('/').slice(0, -1)
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'))
}

// The part of `nodes` whose files have `query` in their path, ignoring case:
// a directory stays when one of its files does. An empty query (after
// trimming) keeps everything.
export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  const needle = query.trim().toLowerCase()
  return needle === '' ? nodes : filterNodes(nodes, needle)
}

function filterNodes(nodes: TreeNode[], needle: string): TreeNode[] {
  const kept: TreeNode[] = []
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (node.path.toLowerCase().includes(needle)) {
        kept.push(node)
      }
      continue
    }
    const children = filterNodes(node.children, needle)
    if (children.length > 0) {
      kept.push({ ...node, children })
    }
  }
  return kept
}
