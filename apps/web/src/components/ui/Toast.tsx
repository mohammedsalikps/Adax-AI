import { CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'

interface ToastItem {
  id: number
  tone: 'success' | 'warning' | 'error'
  message: string
}

const TOAST_TONE: Record<ToastItem['tone'], string> = {
  success: 'border-ok/30 bg-ok-soft text-ok',
  warning: 'border-pending/30 bg-pending-soft text-pending',
  error: 'border-down/30 bg-down-soft text-down',
}

const ToastContext = createContext<(tone: ToastItem['tone'], message: string) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const push = useCallback(
    (tone: ToastItem['tone'], message: string) => {
      const id = Date.now() + Math.random()
      setItems((xs) => [...xs.slice(-3), { id, tone, message }])
      setTimeout(() => dismiss(id), tone === 'success' ? 4000 : 8000)
    },
    [dismiss],
  )
  const value = useMemo(() => push, [push])
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 print:hidden">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-md items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${TOAST_TONE[t.tone]}`}
          >
            {t.tone === 'error' ? <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : t.tone === 'warning' ? <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
            <p className="flex-1 font-medium">{t.message}</p>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss notification" className="rounded p-0.5 hover:bg-black/5">
              <X aria-hidden="true" className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
