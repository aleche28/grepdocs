import { describe, expect, test } from 'vitest'
import { trackedDocument } from '../../test/documents.tsx'
import { ancestorPaths, buildTree, filterTree, type TreeNode } from './tree.ts'

// The tree as nested names, directories ending in "/", to compare at a
// glance.
function outline(nodes: TreeNode[]): unknown[] {
  return nodes.map((node) =>
    node.kind === 'directory'
      ? { [`${node.name}/`]: outline(node.children) }
      : node.name,
  )
}

function treeOf(...paths: string[]) {
  return buildTree(paths.map((path) => trackedDocument({ path })))
}

describe('buildTree', () => {
  test('is empty without documents', () => {
    expect(buildTree([])).toEqual([])
  })

  test('keeps a file at the root as a file', () => {
    const readme = trackedDocument({ path: 'README.md' })

    expect(buildTree([readme])).toEqual([
      { kind: 'file', name: 'README.md', path: 'README.md', document: readme },
    ])
  })

  test('nests files in their directories, each created once', () => {
    const tree = treeOf(
      'docs/guides/setup.md',
      'docs/api/auth.md',
      'docs/guides/faq.md',
      'docs/index.md',
    )

    expect(outline(tree)).toEqual([
      {
        'docs/': [
          { 'api/': ['auth.md'] },
          { 'guides/': ['faq.md', 'setup.md'] },
          'index.md',
        ],
      },
    ])
    const docs = tree[0]
    expect(docs).toMatchObject({ kind: 'directory', path: 'docs' })
    if (docs.kind === 'directory') {
      expect(docs.children[1]).toMatchObject({ path: 'docs/guides' })
    }
  })

  test('puts directories before files', () => {
    expect(outline(treeOf('README.md', 'zz/a.md', 'CHANGELOG.md'))).toEqual([
      { 'zz/': ['a.md'] },
      'CHANGELOG.md',
      'README.md',
    ])
  })

  test('sorts numbers by value and ignores case', () => {
    expect(
      outline(treeOf('10-faq.md', 'b.md', '2-setup.md', 'A.md', 'Z.md')),
    ).toEqual(['2-setup.md', '10-faq.md', 'A.md', 'b.md', 'Z.md'])
  })

  test('keeps names that differ only in case apart, in a stable order', () => {
    const tree = treeOf('docs/b.md', 'Docs/a.md', 'readme.md', 'README.md')

    expect(outline(tree)).toEqual([
      { 'Docs/': ['a.md'] },
      { 'docs/': ['b.md'] },
      'README.md',
      'readme.md',
    ])
  })

  test('handles deep paths', () => {
    expect(outline(treeOf('a/b/c/d/e.md'))).toEqual([
      { 'a/': [{ 'b/': [{ 'c/': [{ 'd/': ['e.md'] }] }] }] },
    ])
  })
})

describe('ancestorPaths', () => {
  test('lists the directories that hold a path, outermost first', () => {
    expect(ancestorPaths('docs/guides/setup.md')).toEqual([
      'docs',
      'docs/guides',
    ])
    expect(ancestorPaths('README.md')).toEqual([])
  })
})

describe('filterTree', () => {
  const tree = treeOf(
    'README.md',
    'docs/guides/Setup.md',
    'docs/guides/faq.md',
    'docs/api/auth.md',
  )

  test('keeps everything for an empty or blank query', () => {
    expect(filterTree(tree, '')).toBe(tree)
    expect(filterTree(tree, '  ')).toBe(tree)
  })

  test('keeps the files whose path matches, ignoring case, and their directories', () => {
    expect(outline(filterTree(tree, ' setup '))).toEqual([
      { 'docs/': [{ 'guides/': ['Setup.md'] }] },
    ])
  })

  test('matches directory names in the path', () => {
    expect(outline(filterTree(tree, 'guides/'))).toEqual([
      { 'docs/': [{ 'guides/': ['faq.md', 'Setup.md'] }] },
    ])
  })

  test('is empty when nothing matches', () => {
    expect(filterTree(tree, 'nothing')).toEqual([])
  })

  test('leaves the tree it filters unchanged', () => {
    filterTree(tree, 'auth')

    expect(outline(tree)).toEqual([
      {
        'docs/': [
          { 'api/': ['auth.md'] },
          { 'guides/': ['faq.md', 'Setup.md'] },
        ],
      },
      'README.md',
    ])
  })
})
