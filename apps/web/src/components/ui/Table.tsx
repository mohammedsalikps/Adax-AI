import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: ReactNode
  cell: (row: T) => ReactNode
  className?: string
}

/** Accessible data table; scrolls horizontally inside its card on small screens. */
export function Table<T>({ columns, rows, rowKey, caption, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; caption: string; empty?: ReactNode }) {
  if (!rows.length && empty) return <>{empty}</>
  return (
    // `relative` matters: without a positioned ancestor, absolutely positioned
    // descendants (e.g. sr-only header text) escape the scroll container and
    // widen the whole page on phones.
    // Focusable, labelled region so keyboard users can scroll it horizontally.
    <div className="relative overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2" tabIndex={0} role="region" aria-label={caption}>
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted uppercase">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-4 py-2 font-medium whitespace-nowrap ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-line last:border-0 hover:bg-canvas/60">
              {columns.map((c) => (
                <td key={c.key} className={`px-4 py-3 align-top ${c.className ?? ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
