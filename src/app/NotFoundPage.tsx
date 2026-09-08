import { Link } from 'react-router-dom'
import { CircleAlert } from 'lucide-react'

export function NotFoundPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="panel flex items-start gap-4 p-8">
        <div className="bg-caution-soft text-caution flex size-11 shrink-0 items-center justify-center rounded-control">
          <CircleAlert size={20} aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Screen not found</h2>
          <p className="mt-1.5 text-ink-soft">
            This route does not exist in the doctor console.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex h-9 items-center rounded-control bg-accent px-3.5 text-xs font-semibold text-ink-inverse transition-colors hover:bg-accent-hover"
          >
            Back to Today&rsquo;s Clinic
          </Link>
        </div>
      </div>
    </div>
  )
}
