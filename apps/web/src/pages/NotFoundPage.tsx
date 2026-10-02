import { Link } from 'react-router'
import { PublicLayout } from '../components/PublicLayout.tsx'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <PublicLayout title="Page not found" subtitle="The page you asked for does not exist.">
      <Link to="/" className="block text-center font-medium text-brand-strong hover:underline">
        Go to your home page
      </Link>
    </PublicLayout>
  )
}
