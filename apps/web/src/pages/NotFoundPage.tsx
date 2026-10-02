import { Link } from 'react-router'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function NotFoundPage() {
  useDocumentTitle('Page not found')
  return (
    <div className="max-w-xl space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-ink-muted">The page you asked for does not exist.</p>
      <Link to="/" className="inline-block rounded-md font-medium text-brand-strong hover:underline">
        Go to home
      </Link>
    </div>
  )
}
