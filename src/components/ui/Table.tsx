import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { EmptyState } from './EmptyState'
import { LoadingState } from './LoadingState'

export type ColumnAlign = 'left' | 'center' | 'right'

const ALIGN_CLASSES: Record<ColumnAlign, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
}

export interface TableColumn<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  align?: ColumnAlign
  /** Any CSS width, e.g. "120px" or "20%". */
  width?: string
  headerClassName?: string
  cellClassName?: string
}

export interface TableProps<T> {
  columns: TableColumn<T>[]
  rows: T[]
  /** Stable key for each row. */
  getRowId: (row: T) => string
  onRowClick?: (row: T) => void
  dense?: boolean
  loading?: boolean
  /** Replaces the default "no records" message. */
  emptyState?: ReactNode
  /** Keeps the header visible inside a scrolling container. */
  stickyHeader?: boolean
  caption?: string
  className?: string
}

/** Generic data table. Column renderers are typed against the row shape. */
export function Table<T>({
  columns,
  rows,
  getRowId,
  onRowClick,
  dense = false,
  loading = false,
  emptyState,
  stickyHeader = false,
  caption,
  className,
}: TableProps<T>) {
  if (loading) {
    return <LoadingState variant="skeleton" rows={4} label="Loading records" />
  }

  if (rows.length === 0) {
    return (
      <>
        {emptyState ?? (
          <EmptyState title="No records" description="Nothing to display yet." />
        )}
      </>
    )
  }

  const cellPadding = dense ? 'px-3 py-1.5' : 'px-3.5 py-2.5'

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-left">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className={cn(stickyHeader && 'sticky top-0 z-10')}>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  'border-b border-line bg-surface-alt font-semibold tracking-wide text-ink-muted uppercase',
                  'text-[10px] whitespace-nowrap',
                  cellPadding,
                  ALIGN_CLASSES[column.align ?? 'left'],
                  column.headerClassName,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={getRowId(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onRowClick(row)
                      }
                    }
                  : undefined
              }
              className={cn(
                'border-b border-line last:border-b-0',
                onRowClick && 'cursor-pointer transition-colors hover:bg-surface-alt',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'text-[13px] text-ink-soft',
                    cellPadding,
                    ALIGN_CLASSES[column.align ?? 'left'],
                    column.cellClassName,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
