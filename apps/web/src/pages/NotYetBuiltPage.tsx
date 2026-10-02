import { Card, PageHeader } from '../components/ui/Layout.tsx'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

/** Shown for screens that are planned but not implemented yet. States that plainly. */
export function NotYetBuiltPage({ title, planned }: { title: string; planned: string[] }) {
  useDocumentTitle(title)
  return (
    <>
      <PageHeader title={title} />
      <Card title="Not yet available">
        <p className="text-sm text-ink-muted">This screen is planned but not built yet. Planned:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {planned.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </Card>
    </>
  )
}
