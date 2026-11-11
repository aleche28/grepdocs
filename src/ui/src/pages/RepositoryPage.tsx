import { Outlet, useParams } from 'react-router'

// Placeholder for #70: the document tree, with the selected document beside it.
export function RepositoryPage() {
  const { repoId } = useParams()

  return (
    <>
      <h1>Repository {repoId}</h1>
      <Outlet />
    </>
  )
}
