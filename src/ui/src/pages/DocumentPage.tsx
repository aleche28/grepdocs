import { useParams } from 'react-router'

// Placeholder for #71.
export function DocumentPage() {
  const { documentId } = useParams()

  return <h2>Document {documentId}</h2>
}
